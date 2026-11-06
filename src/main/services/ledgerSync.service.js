import { normalizeSyncPlan, syncPlanKey } from "./syncPlan.js";
import { readSyncBatches } from "./ledgerSync.batches.js";
import { companyGuid, validateCompanyList } from "../utils/companyIdentity.js";
import { cacheScope } from "../models/ledgerCache.model.js";
import { createLedgerSyncSource } from "./ledgerSync.source.js";
import { manifestKey } from "../utils/tally-connector-engine/modules/ledgers/ledgerCache.mapper.js";
import { companyNameKey } from "../utils/companyName.js";

// Voucher XML contains ledger, inventory, bill and bank allocation details.
// Start with 100 and shrink a failed batch to stay under the 5 MB response limit.
const VOUCHER_SYNC_BATCH_SIZE = 100;

export async function syncLedgerCompany({
  cache,
  scope,
  identity,
  source,
  signal,
  onProgress = () => {},
  batchDelayMs = 500,
  batchSize = VOUCHER_SYNC_BATCH_SIZE,
  components,
  from_date,
  to_date,
  refresh_opening = false,
  automatic = false,
}) {
  const plan = normalizeSyncPlan({
    components,
    refresh_opening,
    from_date,
    to_date,
    batch_size: batchSize,
    delay_ms: Math.max(250, batchDelayMs),
  });
  const full = plan.components.includes("vouchers");
  const run = cache.begin(scope, identity, plan);
  try {
    source.setCheckpoint?.(run, cache, onProgress);
    const rawLedgers = plan.components.includes("ledgers")
      ? await source.ledgers(identity.name)
      : [];
    if (plan.components.includes("ledgers") && !rawLedgers.length)
      throw new Error(
        "Tally returned no ledger masters. The previous local snapshot is preserved.",
      );
    cache.stageLedgers(run, rawLedgers);
    const stockItems = plan.components.includes("stock_items")
      ? await source.stockItems(identity.name)
      : [];
    cache.stageStockItems(run, stockItems);
    signal.throwIfAborted();
    if (full) {
      const checkedLedgers = await source.ledgers(identity.name);
      const checkedStockItems = await source.stockItems(identity.name);
      const checkedCompanies = await source.companies();
      signal.throwIfAborted();
      if (
        JSON.stringify(rawLedgers) !== JSON.stringify(checkedLedgers) ||
        JSON.stringify(stockItems) !== JSON.stringify(checkedStockItems) ||
        !checkedCompanies.some(
          (row) =>
            row.guid.toLowerCase() === identity.guid.toLowerCase() && row.name === identity.name,
        )
      )
        throw new Error(
          "Tally masters changed while syncing. Saved chunks are preserved; retry before starting transactions.",
        );
      cache.publishMasters(run);
      onProgress({
        company: identity.name,
        phase: "masters_ready",
        completed: rawLedgers.length + stockItems.length,
        total: rawLedgers.length + stockItems.length,
        ledgers: rawLedgers.length,
        stock_items: stockItems.length,
      });
    }
    signal.throwIfAborted();
    const cachedOpening =
      full && !plan.refresh_opening ? cache.openingBaseline?.(run, rawLedgers) : null;
    if (automatic && full && source.openingSnapshot && !cachedOpening)
      throw Object.assign(
        new Error(
          "Opening history needs a manual sync or refresh. Automatic sync will not scan historical data. Open Sync and start the selected company once.",
        ),
        { code: "OPENING_REFRESH_REQUIRED" },
      );
    let opening = cachedOpening;
    if (full && source.openingSnapshot && !opening) {
      onProgress({
        company: identity.name,
        phase: "opening",
        completed: 0,
        total: null,
        index_from: null,
        index_to: null,
      });
      opening = await source.openingSnapshot(identity.name, rawLedgers, plan.from_date);
      signal.throwIfAborted();
      const checkedOpening = await source.openingSnapshot(
        identity.name,
        rawLedgers,
        plan.from_date,
      );
      const checkedMasters = await source.ledgers(identity.name);
      signal.throwIfAborted();
      if (
        JSON.stringify(opening) !== JSON.stringify(checkedOpening) ||
        JSON.stringify(rawLedgers) !== JSON.stringify(checkedMasters)
      )
        throw new Error(
          "Opening history changed during preparation. Previous baseline and saved vouchers are preserved; retry manually.",
        );
      cache.saveOpeningBaseline?.(run, rawLedgers, opening);
    }
    if (cachedOpening) onProgress({ phase: "opening_cached", completed: 0, total: null });
    const ledgers = opening?.ledgers || rawLedgers;
    if (opening) cache.stageOpening(run, opening.bills);
    signal.throwIfAborted();
    const manifest = full ? await source.manifest(identity.name) : [];
    const previous = cache.signatures(run);
    const incompleteDetails = cache.incompleteDetails(run);
    const names = new Set(ledgers.map((row) => row.name));
    // Renaming a ledger can change serialized voucher allocation names without
    // changing each voucher's AlterID. Refresh those allocations conservatively.
    const removedOrRenamedLedger = cache.ledgers(run).some((row) => !names.has(row.name));
    const changed = manifest.filter(
      (row) =>
        removedOrRenamedLedger ||
        incompleteDetails.has(row.id) ||
        previous.get(row.id) !== row.signature,
    );
    const saved = cache.prepareResume(run, ledgers, stockItems, manifest, changed.length);
    const remaining = changed.filter((row) => saved.get(row.id) !== row.signature);
    const resumed = changed.length - remaining.length;
    cache.stageLedgers(run, ledgers);
    onProgress({
      company: identity.name,
      total: changed.length,
      completed: resumed,
      resumed,
      phase: "fetching",
      ledgers: ledgers.length,
    });
    for await (const { rows, completed, batchSize: actualBatchSize } of readSyncBatches(remaining, {
      read: (batch) => source.vouchers(identity.name, batch),
      signal,
      batchSize,
      delayMs: batchDelayMs,
      describe: (row) => `Voucher MasterID ${row.id} in '${identity.name}'`,
      onResize: ({ completed, batch_size }) =>
        onProgress({
          company: identity.name,
          total: changed.length,
          completed: resumed + completed,
          resumed,
          phase: "fetching",
          ledgers: ledgers.length,
          batch_size,
          retrying: true,
        }),
    })) {
      if (rows.some((row) => row.entries.some((entry) => !names.has(entry.ledger_name))))
        throw new Error(
          "Tally voucher references a ledger missing from the master snapshot. Sync will retry.",
        );
      cache.stageVouchers(run, rows);
      onProgress({
        company: identity.name,
        total: changed.length,
        completed: resumed + completed,
        resumed,
        phase: "fetching",
        ledgers: ledgers.length,
        batch_size: actualBatchSize,
      });
    }
    // Never publish a partial or changing source snapshot. Missing IDs in a
    // completed manifest are deletions, including old/backdated vouchers.
    onProgress({
      company: identity.name,
      total: changed.length,
      completed: changed.length,
      phase: "verifying",
      ledgers: ledgers.length,
    });
    const verifyManifest = full ? await source.manifest(identity.name) : [];
    const verifyRawLedgers = plan.components.includes("ledgers")
      ? await source.ledgers(identity.name)
      : [];
    // The verified baseline is independent of voucher refreshes. Never rescan history here.
    const verifyOpening =
      opening && cache.openingBaseline ? cache.openingBaseline(run, verifyRawLedgers) : opening;
    if (opening && !verifyOpening)
      throw new Error(
        "Ledger opening inputs changed during sync. Refresh opening history manually; saved vouchers are preserved.",
      );
    const verifyLedgers = verifyOpening?.ledgers || verifyRawLedgers;
    const verifyStockItems = plan.components.includes("stock_items")
      ? await source.stockItems(identity.name)
      : [];
    const companies = await source.companies();
    signal.throwIfAborted();
    if (
      manifestKey(manifest) !== manifestKey(verifyManifest) ||
      JSON.stringify(ledgers) !== JSON.stringify(verifyLedgers) ||
      JSON.stringify(stockItems) !== JSON.stringify(verifyStockItems) ||
      (opening && JSON.stringify(opening.bills) !== JSON.stringify(verifyOpening.bills)) ||
      !companies.some(
        (company) =>
          company.guid.toLowerCase() === identity.guid.toLowerCase() &&
          company.name === identity.name,
      )
    ) {
      throw new Error(
        "Tally changed during sync. The previous complete snapshot is preserved; the next sync will retry.",
      );
    }
    const lastSyncedAt = full ? cache.publish(run, manifest) : cache.publishPartial(run);
    return {
      last_synced_at: lastSyncedAt,
      vouchers: manifest.length,
      updated: changed.length,
      ledgers: ledgers.length,
    };
  } catch (error) {
    cache.fail(
      run,
      signal.aborted
        ? Object.assign(new Error("Sync paused. Saved chunks can be resumed."), {
            code: "SYNC_PAUSED",
          })
        : error,
    );
    throw error;
  }
}

export function createLedgerSync({
  cache,
  onActivity = () => {},
  sourceFactory = createLedgerSyncSource,
  intervalMs = 180_000,
}) {
  let config;
  let timer;
  let controller;
  let running = false;
  let enabled = false;
  let autoScheduled = false;
  let revision = 0;
  let pendingAuto = false;
  let progress = {
    state: "idle",
    phase: "idle",
    company: null,
    company_guid: null,
    completed: 0,
    total: null,
    error: null,
    next_sync_at: null,
    company_index: 0,
    company_total: 0,
    resumed: 0,
  };
  async function tick(options = {}) {
    if (running || !enabled) return;
    running = true;
    const activeConfig = { ...config };
    const startedRevision = revision;
    const abort = new AbortController();
    controller = abort;
    const plan = normalizeSyncPlan(options);
    progress = {
      ...progress,
      state: "syncing",
      phase: "discovering",
      error: null,
      completed: 0,
      total: null,
      resumed: 0,
      components: plan.components,
      sync_plan: syncPlanKey(plan),
      from_date: plan.from_date,
      to_date: plan.to_date,
    };
    try {
      const source = sourceFactory(activeConfig, abort.signal, {
        batchDelayMs: plan.delay_ms,
        batchMasters: true,
        from_date: plan.from_date,
        to_date: plan.to_date,
      });
      const open = await source.companies();
      const all = open.map((row) => ({ ...row, guid: companyGuid(row.guid) }));
      validateCompanyList(all);
      const selected = options.company_guid
        ? all.filter((row) => row.guid === companyGuid(options.company_guid))
        : all;
      if (!selected.length)
        throw new Error("Requested company is not open in Tally. Open it and retry.");
      const failures = [];
      for (const identity of selected) {
        abort.signal.throwIfAborted();
        if (
          all.filter((row) => companyNameKey(row.name) === companyNameKey(identity.name)).length !==
          1
        )
          throw new Error(
            "Multiple open companies share this name. Close the other company before syncing.",
          );
        progress = {
          ...progress,
          phase: "reading",
          company: identity.name,
          company_guid: identity.guid,
          company_index: selected.indexOf(identity) + 1,
          company_total: selected.length,
          total: null,
          completed: 0,
          resumed: 0,
        };
        onActivity({
          status: "fetching",
          message: `Syncing local database for ${identity.name}…`,
          at: new Date().toISOString(),
        });
        try {
          const result = await syncLedgerCompany({
            cache,
            scope: cacheScope(activeConfig),
            identity,
            source,
            signal: abort.signal,
            components: plan.components,
            refresh_opening: plan.refresh_opening,
            automatic: options.automatic === true,
            from_date: plan.from_date,
            to_date: plan.to_date,
            batchSize: plan.batch_size,
            batchDelayMs: plan.delay_ms,
            onProgress: (update) => {
              progress = { ...progress, ...update };
              if (
                update.retrying ||
                update.completed === update.total ||
                update.completed % 250 === 0
              )
                onActivity({
                  status: "fetching",
                  message:
                    update.phase === "masters_ready"
                      ? `Local sync: ${identity.name}, masters saved (${update.ledgers} ledgers, ${update.stock_items} stock items). Starting transaction preparation.`
                      : update.phase === "opening_cached"
                        ? `Local sync: ${identity.name}, reusing saved opening balances and pending bills; historical scan skipped.`
                        : update.phase === "opening"
                          ? `Local sync: ${identity.name}, preparing opening balances and pending bills${update.index_from ? ` for ${update.index_from}–${update.index_to}` : ""}.`
                          : update.phase === "indexing"
                            ? `Local sync: ${identity.name}, reading voucher IDs and versions only. Saved detail chunks are retained.`
                            : `Local sync: ${identity.name}, ${update.completed}/${update.total} ${update.phase === "masters" ? update.unit : "vouchers"} committed to SQLite; ${update.resumed || 0} reused from checkpoint.`,
                  at: new Date().toISOString(),
                });
            },
          });
          onActivity({
            status: "succeeded",
            message: `Company sync completed: ${identity.name}, ${plan.components.includes("vouchers") ? "complete accounting snapshot" : "selected masters only"}.`,
            at: result.last_synced_at,
          });
        } catch (error) {
          abort.signal.throwIfAborted();
          failures.push(`${identity.name}: ${error.message}`);
        }
      }
      if (failures.length) throw new Error(failures.join("; "));
      progress = {
        ...progress,
        state: plan.components.includes("vouchers") ? "ready" : "partial",
        phase: "complete",
        error: null,
      };
    } catch (error) {
      progress = {
        ...progress,
        state: abort.signal.aborted ? "paused" : "failed",
        phase: abort.signal.aborted ? "paused" : "failed",
        error: abort.signal.aborted ? null : error.message,
      };
      if (!abort.signal.aborted)
        onActivity({
          status: "failed",
          message: `Local sync failed: ${error.message}`,
          at: new Date().toISOString(),
        });
    } finally {
      running = false;
      if (enabled && revision !== startedRevision && pendingAuto) {
        pendingAuto = false;
        void tick({ automatic: true });
      }
    }
  }
  function pause() {
    autoScheduled = false;
    clearInterval(timer);
    controller?.abort();
    progress = { ...progress, state: "paused", phase: "paused", error: null, next_sync_at: null };
  }
  function stop() {
    enabled = false;
    revision++;
    pendingAuto = false;
    pause();
  }
  function start(nextConfig) {
    stop();
    config = { ...nextConfig };
    enabled = true;
    autoScheduled = Boolean(config.autoSync);
    progress = { ...progress, state: "idle", phase: "idle", next_sync_at: null };
    if (autoScheduled) {
      timer = setInterval(() => {
        progress = { ...progress, next_sync_at: new Date(Date.now() + intervalMs).toISOString() };
        void tick({ automatic: true });
      }, intervalMs);
      timer.unref?.();
      progress.next_sync_at = new Date(Date.now() + intervalMs).toISOString();
      if (running) pendingAuto = true;
      else void tick({ automatic: true });
    }
  }
  function startManual(activeConfig, options) {
    if (!enabled) throw new Error("Connect the Connector before starting local sync.");
    if (running)
      throw new Error("A sync is already running. Pause it and wait before starting another.");
    const plan = normalizeSyncPlan(options);
    const guid = companyGuid(options.company_guid);
    if (cacheScope(activeConfig) !== cacheScope(config))
      throw new Error("Connection settings changed. Reconnect before syncing.");
    void tick({ ...plan, company_guid: guid });
    return { success: true };
  }
  function statement(activeConfig, lookup) {
    const company = resolveCompany(activeConfig, lookup.company_guid);
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    const resolved = cache.resolveLedger(cacheScope(activeConfig), {
      ...lookup,
      company,
      report_snapshot: true,
      company_guid: companyGuid(lookup.company_guid),
    });
    return cache.statement(
      cacheScope(activeConfig),
      {
        ...lookup,
        ...resolved,
        company,
        company_guid: companyGuid(lookup.company_guid),
      },
      { syncing: running, connected: enabled },
    );
  }
  function groupSummary(activeConfig, lookup) {
    const company = resolveCompany(activeConfig, lookup.company_guid);
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    return cache.groupSummary(
      cacheScope(activeConfig),
      { ...lookup, company, company_guid: companyGuid(lookup.company_guid) },
      { syncing: running, connected: enabled },
    );
  }
  function outstanding(activeConfig, lookup) {
    const company = resolveCompany(activeConfig, lookup.company_guid);
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    const resolved = cache.resolveLedger(cacheScope(activeConfig), {
      ...lookup,
      company,
      report_snapshot: true,
      company_guid: companyGuid(lookup.company_guid),
    });
    return cache.outstanding(
      cacheScope(activeConfig),
      {
        ...lookup,
        ...resolved,
        company,
        company_guid: companyGuid(lookup.company_guid),
      },
      { syncing: running, connected: enabled },
    );
  }
  function resolveLedger(activeConfig, lookup) {
    const company =
      listCompanies(activeConfig).find(
        (row) => row.company_key === companyGuid(lookup.company_guid),
      )?.company_name || lookup.company;
    if (!company)
      throw Object.assign(
        new Error("Pass company in the request when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    return cache.resolveLedger(cacheScope(activeConfig), {
      ...lookup,
      company,
      company_guid: companyGuid(lookup.company_guid),
    });
  }
  function getStatus(activeConfig) {
    const visibleCompany = progress.company;
    const totals = cache.summary(cacheScope(activeConfig), visibleCompany);
    const dates = totals.companies
      .map((row) => row.last_synced_at)
      .filter(Boolean)
      .sort();
    const details = cache.syncDetails(cacheScope(activeConfig));
    const activeCheckpoint = progress.company_guid
      ? details.checkpoints.find(
          (row) => row.guid === progress.company_guid && row.plan === progress.sync_plan,
        )
      : details.checkpoints[0];
    return {
      ...progress,
      ...totals,
      ...details,
      active_checkpoint: activeCheckpoint || null,
      enabled,
      auto_sync: autoScheduled,
      running,
      last_synced_at: dates[0] || null,
    };
  }
  function listCompanies(activeConfig) {
    const scope = cacheScope(activeConfig);
    return cache.listCompanies(scope).map((row) => ({
      company_name: row.name,
      tally_guid: row.tally_guid || row.guid,
      company_key: row.guid,
      ...JSON.parse(row.identity_json || "{}"),
      status: row.active && row.last_synced_at ? "active" : "inactive",
      sync_status: row.sync_status,
      last_synced_at: row.last_synced_at || null,
      ...(row.sync_error ? { sync_error: row.sync_error } : {}),
    }));
  }
  function resolveCompany(activeConfig, companyId) {
    if (!companyId) return null;
    const company = listCompanies(activeConfig).find(
      (item) => item.company_key === String(companyId).toLowerCase(),
    );
    if (!company)
      throw Object.assign(new Error("Company ID does not exist for this Connector."), {
        httpStatus: 404,
        code: "COMPANY_NOT_FOUND",
      });
    if (company.status !== "active")
      throw Object.assign(
        new Error(
          `Local cache for '${company.company_name}' is not ready. Keep Tally open until sync completes.`,
        ),
        {
          httpStatus: 503,
          code: "COMPANY_CACHE_NOT_READY",
        },
      );
    return company.company_name;
  }
  function companyDetails(activeConfig, company, guid) {
    const matches = cache
      .listCompanies(cacheScope(activeConfig))
      .filter((row) =>
        guid
          ? row.guid.toLowerCase() === guid.toLowerCase()
          : companyNameKey(row.name) === companyNameKey(company),
      );
    if (matches.length !== 1)
      throw Object.assign(new Error("Company metadata could not be uniquely resolved."), {
        httpStatus: 409,
      });
    return JSON.parse(
      cache.component(cacheScope(activeConfig), matches[0].guid, "company")?.details_json ||
        cache.company(cacheScope(activeConfig), matches[0].guid)?.company_details_json ||
        "{}",
    );
  }
  function resolveStockItem(activeConfig, lookup) {
    return cache.resolveStockItem(cacheScope(activeConfig), lookup);
  }
  return {
    startManual,
    pause,
    start,
    stop,
    statement,
    groupSummary,
    outstanding,
    companyDetails,
    resolveStockItem,
    resolveLedger,
    listCompanies,
    resolveCompany,
    getStatus,
    get running() {
      return running;
    },
  };
}
