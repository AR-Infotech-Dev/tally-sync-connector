import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { cacheScope } from "../models/ledgerCache.model.js";
import { createLedgerSyncSource } from "./ledgerSync.source.js";
import { manifestKey } from "../utils/tally-connector-engine/modules/ledgers/ledgerCache.mapper.js";
import { companyNameKey } from "../utils/companyName.js";

// Voucher XML contains ledger, inventory, bill and bank allocation details.
// Keep each response comfortably below the transport's 5 MB safety limit.
const VOUCHER_SYNC_BATCH_SIZE = 100;

export async function syncLedgerCompany({
  cache,
  scope,
  identity,
  source,
  signal,
  onProgress = () => {},
  batchDelayMs = 250,
}) {
  const run = cache.begin(scope, identity);
  try {
    const ledgers = await source.ledgers(identity.name);
    if (!ledgers.length)
      throw new Error(
        "Tally returned no ledger masters. The previous local snapshot is preserved.",
      );
    const stockItems = await source.stockItems(identity.name);
    cache.stageStockItems(run, stockItems);
    signal.throwIfAborted();
    const manifest = await source.manifest(identity.name);
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
    cache.stageLedgers(run, ledgers);
    onProgress({
      company: identity.name,
      total: changed.length,
      completed: 0,
      phase: "fetching",
      ledgers: ledgers.length,
    });
    for (let index = 0; index < changed.length; index += VOUCHER_SYNC_BATCH_SIZE) {
      signal.throwIfAborted();
      const batch = changed.slice(index, index + VOUCHER_SYNC_BATCH_SIZE);
      const rows = await source.vouchers(identity.name, batch);
      signal.throwIfAborted();
      if (rows.some((row) => row.entries.some((entry) => !names.has(entry.ledger_name))))
        throw new Error(
          "Tally voucher references a ledger missing from the master snapshot. Sync will retry.",
        );
      cache.stageVouchers(run, rows);
      onProgress({
        company: identity.name,
        total: changed.length,
        completed: Math.min(index + VOUCHER_SYNC_BATCH_SIZE, changed.length),
        phase: "fetching",
        ledgers: ledgers.length,
      });
      if (batchDelayMs) await delay(batchDelayMs, undefined, { signal });
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
    const verifyManifest = await source.manifest(identity.name);
    const verifyLedgers = await source.ledgers(identity.name);
    const verifyStockItems = await source.stockItems(identity.name);
    const companies = await source.companies();
    signal.throwIfAborted();
    if (
      manifestKey(manifest) !== manifestKey(verifyManifest) ||
      JSON.stringify(ledgers) !== JSON.stringify(verifyLedgers) ||
      JSON.stringify(stockItems) !== JSON.stringify(verifyStockItems) ||
      !companies.some((company) => company.guid === identity.guid && company.name === identity.name)
    ) {
      throw new Error(
        "Tally changed during sync. The previous complete snapshot is preserved; the next sync will retry.",
      );
    }
    const lastSyncedAt = cache.publish(run, manifest);
    return {
      last_synced_at: lastSyncedAt,
      vouchers: manifest.length,
      updated: changed.length,
      ledgers: ledgers.length,
    };
  } catch (error) {
    cache.fail(run, error);
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
  let revision = 0;
  let progress = {
    state: "idle",
    phase: "idle",
    company: null,
    completed: 0,
    total: null,
    company_index: 0,
    company_total: 0,
    error: null,
    next_sync_at: null,
  };
  async function tick() {
    if (running || !enabled) return;
    running = true;
    const startedRevision = revision;
    const activeConfig = config;
    controller = new AbortController();
    progress = {
      ...progress,
      state: "syncing",
      phase: "discovering",
      completed: 0,
      total: null,
      company: null,
      error: null,
    };
    try {
      const source = sourceFactory(activeConfig, controller.signal);
      const companies = await source.companies();
      const selected = activeConfig.tallyCompany
        ? companies.filter(
            (company) => companyNameKey(company.name) === companyNameKey(activeConfig.tallyCompany),
          )
        : [];
      if (!selected.length)
        throw new Error(
          activeConfig.tallyCompany
            ? `Configured company '${activeConfig.tallyCompany}' was not found. Open companies: ${companies.map((company) => company.name).join(", ") || "none"}.`
            : "Select a Tally company in Settings before starting sync.",
        );
      if (new Set(selected.map((company) => companyNameKey(company.name))).size !== selected.length)
        throw new Error("Open Tally companies must have unique names for statement requests.");
      for (const identity of selected) {
        controller.signal.throwIfAborted();
        progress = {
          ...progress,
          phase: "reading",
          company: identity.name,
          company_index: selected.indexOf(identity) + 1,
          company_total: selected.length,
          total: null,
          completed: 0,
        };
        onActivity({
          status: "fetching",
          message: `Syncing local ledger database for ${identity.name}…`,
          at: new Date().toISOString(),
        });
        const result = await syncLedgerCompany({
          cache,
          scope: cacheScope(activeConfig),
          identity,
          source,
          signal: controller.signal,
          onProgress: ({ completed, total, phase, ledgers }) => {
            progress = { ...progress, completed, total, phase, ledgers };
            if (completed === total || completed % 250 === 0)
              onActivity({
                status: "fetching",
                message: `Local ledger sync: ${identity.name}, ${completed}/${total} changed vouchers saved in staging.`,
                at: new Date().toISOString(),
              });
          },
        });
        onActivity({
          status: "succeeded",
          message: `Local ledger database synced: ${identity.name}, ${result.ledgers} ledgers, ${result.updated} changed vouchers.`,
          at: result.last_synced_at,
        });
      }
      progress = { ...progress, state: "ready", phase: "complete", error: null };
    } catch (error) {
      if (!controller.signal.aborted) {
        progress = { ...progress, state: "failed", phase: "failed", error: error.message };
        cache.failScope(cacheScope(activeConfig), error);
        onActivity({
          status: "failed",
          message: `Local ledger sync failed: ${error.message}`,
          at: new Date().toISOString(),
        });
      }
    } finally {
      running = false;
      // Config/connect changes abort the old session and immediately start the new one.
      if (enabled && revision !== startedRevision) void tick();
    }
  }
  function stop() {
    enabled = false;
    revision++;
    clearInterval(timer);
    controller?.abort();
    progress = { ...progress, state: "paused", phase: "paused", next_sync_at: null };
  }
  function start(nextConfig) {
    stop();
    config = { ...nextConfig };
    enabled = true;
    progress = { ...progress, next_sync_at: new Date(Date.now() + intervalMs).toISOString() };
    timer = setInterval(() => {
      progress = { ...progress, next_sync_at: new Date(Date.now() + intervalMs).toISOString() };
      void tick();
    }, intervalMs);
    timer.unref?.();
    void tick();
  }
  function statement(activeConfig, lookup) {
    const company =
      resolveCompany(activeConfig, lookup.company_id) ||
      lookup.company ||
      activeConfig.tallyCompany;
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    const resolved = cache.resolveLedger(cacheScope(activeConfig), { ...lookup, company });
    return cache.statement(
      cacheScope(activeConfig),
      { ...lookup, ...resolved, company },
      { syncing: running, connected: enabled },
    );
  }
  function groupSummary(activeConfig, lookup) {
    const company =
      resolveCompany(activeConfig, lookup.company_id) ||
      lookup.company ||
      activeConfig.tallyCompany;
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    return cache.groupSummary(
      cacheScope(activeConfig),
      { ...lookup, company },
      { syncing: running, connected: enabled },
    );
  }
  function outstanding(activeConfig, lookup) {
    const company =
      resolveCompany(activeConfig, lookup.company_id) ||
      lookup.company ||
      activeConfig.tallyCompany;
    if (!company)
      throw Object.assign(
        new Error("Pass company in the body when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    const resolved = cache.resolveLedger(cacheScope(activeConfig), { ...lookup, company });
    return cache.outstanding(
      cacheScope(activeConfig),
      { ...lookup, ...resolved, company },
      { syncing: running, connected: enabled },
    );
  }
  function resolveLedger(activeConfig, lookup) {
    const company = lookup.company || activeConfig.tallyCompany;
    if (!company)
      throw Object.assign(
        new Error("Pass company in the request when multiple Tally companies are cached."),
        { httpStatus: 400 },
      );
    return cache.resolveLedger(cacheScope(activeConfig), { ...lookup, company });
  }
  function getStatus(activeConfig) {
    const visibleCompany = progress.company || activeConfig.tallyCompany;
    const totals = cache.summary(cacheScope(activeConfig), visibleCompany);
    const dates = totals.companies
      .map((row) => row.last_synced_at)
      .filter(Boolean)
      .sort();
    return { ...progress, ...totals, enabled, last_synced_at: dates[0] || null };
  }
  function listCompanies(activeConfig) {
    const scope = cacheScope(activeConfig);
    return cache.listCompanies(scope).map((row) => ({
      company_id: `COMP_${createHash("sha256").update(`${activeConfig.clientId}:${row.guid}`).digest("hex").slice(0, 20).toUpperCase()}`,
      company_name: row.name,
      tally_guid: row.guid,
      status: row.active && row.sync_status === "ready" ? "active" : "inactive",
      last_synced_at: row.last_synced_at || null,
      ...(row.sync_error ? { sync_error: row.sync_error } : {}),
    }));
  }
  function resolveCompany(activeConfig, companyId) {
    if (!companyId) return activeConfig.tallyCompany || null;
    const company = listCompanies(activeConfig).find((item) => item.company_id === companyId);
    if (!company)
      throw Object.assign(new Error("Company ID does not exist for this Connector."), {
        httpStatus: 404,
        code: "COMPANY_NOT_FOUND",
      });
    if (company.status !== "active")
      throw Object.assign(new Error(`Company '${company.company_name}' is not active in Tally.`), {
        httpStatus: 409,
        code: "COMPANY_NOT_ACTIVE",
      });
    if (
      !activeConfig.tallyCompany ||
      companyNameKey(company.company_name) !== companyNameKey(activeConfig.tallyCompany)
    ) {
      throw Object.assign(
        new Error(
          `Company '${company.company_name}' is not the selected/open Tally company on this Connector.`,
        ),
        { httpStatus: 409, code: "COMPANY_NOT_OPEN" },
      );
    }
    return company.company_name;
  }
  function companyDetails(activeConfig, company) {
    const matches = cache
      .listCompanies(cacheScope(activeConfig))
      .filter((row) => companyNameKey(row.name) === companyNameKey(company));
    if (matches.length !== 1)
      throw Object.assign(new Error("Company metadata could not be uniquely resolved."), {
        httpStatus: 409,
      });
    return JSON.parse(
      cache.company(cacheScope(activeConfig), matches[0].guid)?.company_details_json || "{}",
    );
  }
  function resolveStockItem(activeConfig, lookup) {
    return cache.resolveStockItem(cacheScope(activeConfig), lookup);
  }
  return {
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
