import { createTallyHttpTransport } from "../utils/tally-connector-engine/transport/httpTransport.js";
import {
  buildOpeningBalancesRequest,
  openingCutoff,
  parseOpeningBalances,
} from "../utils/tally-connector-engine/modules/ledgers/openingSnapshot.mapper.js";
import {
  buildOpeningHistoryRequest,
  parseOpeningHistory,
} from "../utils/tally-connector-engine/modules/ledgers/openingHistory.mapper.js";
import { carryForwardBills } from "./outstandingBills.utils.js";
import {
  readSyncBatches,
  splitSyncDateRange,
  initialManifestRanges,
} from "./ledgerSync.batches.js";
import { setTimeout as delay } from "node:timers/promises";
import {
  buildCacheStockItemsRequest,
  parseCacheStockItems,
} from "../utils/tally-connector-engine/modules/ledgers/stockItems.mapper.js";
import {
  buildCacheVoucherTypesRequest,
  parseCacheVoucherTypes,
  buildCacheCompaniesRequest,
  parseCacheCompanies,
  buildCacheLedgersRequest,
  parseCacheLedgers,
  buildCacheManifestRequest,
  parseCacheManifest,
  buildCacheVoucherBatchRequest,
  parseCacheVoucherBatch,
  buildCacheMasterIdsRequest,
  parseCacheMasterIds,
  buildCacheMasterManifestRequest,
  parseCacheMasterManifest,
} from "../utils/tally-connector-engine/modules/ledgers/ledgerCache.mapper.js";

export function createLedgerSyncSource(
  config,
  signal,
  {
    transport = createTallyHttpTransport(),
    batchDelayMs = 250,
    batchMasters = false,
    manifestNow = new Date(),
    from_date,
    to_date,
  } = {},
) {
  let companies = [];
  const nonPostingTypes = new Map();
  const batchedMasters = new Set();
  const manifestRanges = new Map();
  let checkpoint;
  const booksFrom = (name) => companies.find((company) => company.name === name)?.books_from;
  async function request(xml, phase) {
    try {
      signal.throwIfAborted();
      const response = await transport.postXml({ url: config.tallyUrl }, xml, {
        timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000,
        signal,
      });
      signal.throwIfAborted();
      if (response.status < 200 || response.status >= 300)
        throw new Error(`Tally ledger sync returned HTTP ${response.status}.`);
      return response.body;
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw Object.assign(
        new Error(`Tally sync failed while reading ${phase}: ${cause.message}`, { cause }),
        {
          code: cause.code,
          httpStatus: cause.httpStatus,
          maxResponseBytes: cause.maxResponseBytes,
          syncPhase: phase,
        },
      );
    }
  }
  async function readIdBatches(company, objectType, fromDate, toDate, build, parse, phase) {
    const ids = parseCacheMasterIds(
      await request(
        buildCacheMasterIdsRequest(company, objectType, fromDate, toDate),
        `${phase} ID index`,
      ),
      objectType,
    );
    if (!ids.length)
      throw new Error(
        `Tally returned an empty ID index after an oversized ${phase} export. Sync will retry.`,
      );
    const result = [];
    for await (const { rows, batch } of readSyncBatches(ids, {
      signal,
      delayMs: batchDelayMs,
      read: async (batch) => parse(await request(build(batch), `${phase} batch`)),
      describe: (id) => `${objectType} MasterID ${id} in '${company}'`,
    })) {
      const expected = new Set(batch);
      const returned = rows.map((row) => row.id || row.master_id);
      if (
        returned.length !== batch.length ||
        new Set(returned).size !== batch.length ||
        returned.some((id) => !expected.has(id))
      ) {
        throw new Error(
          `Tally changed while reading ${phase}. The MasterID batch is incomplete; sync will retry.`,
        );
      }
      result.push(...rows);
    }
    return result;
  }

  async function readMasters(company, objectType, fromDate, build, parse, phase) {
    if (batchMasters && checkpoint) {
      const { run, cache, onProgress } = checkpoint;
      const index = parseCacheMasterManifest(
        await request(
          buildCacheMasterManifestRequest(company, objectType, fromDate),
          `${phase} index`,
        ),
        objectType,
      );
      const stored = cache.masterCheckpointRows(run, objectType);
      const pending = index.filter((row) => stored.get(row.id)?.signature !== row.signature);
      const reused = index.length - pending.length;
      onProgress({
        phase: "masters",
        unit: phase,
        total: index.length,
        completed: reused,
        resumed: reused,
      });
      for await (const { rows, batch, completed } of readSyncBatches(pending, {
        signal,
        delayMs: batchDelayMs,
        batchSize: 100,
        read: async (batch) =>
          parse(await request(build(batch.map((row) => row.id)), `${phase} batch`)),
        describe: (row) => `${objectType} MasterID ${row.id}`,
      })) {
        const expected = new Map(batch.map((row) => [row.id, row.signature]));
        if (
          rows.length !== batch.length ||
          new Set(rows.map((row) => row.master_id)).size !== batch.length ||
          rows.some((row) => !expected.has(row.master_id))
        )
          throw new Error(`Incomplete ${phase} batch. Checkpoint preserved.`);
        const entries = rows.map((row) => ({
          id: row.master_id,
          signature: expected.get(row.master_id),
          row,
        }));
        cache.saveMasterCheckpointRows(run, objectType, entries);
        entries.forEach((row) => stored.set(row.id, row));
        onProgress({
          phase: "masters",
          unit: phase,
          total: index.length,
          completed: reused + completed,
          resumed: reused,
        });
      }
      return index
        .map((row) => stored.get(row.id).row)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    const key = `${company}:${objectType}`;
    if (!batchedMasters.has(key)) {
      try {
        return parse(await request(build(), phase));
      } catch (error) {
        if (error.code !== "TALLY_RESPONSE_TOO_LARGE") throw error;
        batchedMasters.add(key);
        if (batchDelayMs) await delay(batchDelayMs, undefined, { signal });
      }
    }
    const rows = await readIdBatches(company, objectType, fromDate, undefined, build, parse, phase);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function readManifest(company) {
    checkpoint?.onProgress({ phase: "indexing", completed: 0, total: null, indexed_vouchers: 0 });
    const fromDate = from_date ? from_date.replaceAll("-", "") : booksFrom(company),
      toDate = to_date ? to_date.replaceAll("-", "") : "20991231";
    let ranges =
      manifestRanges.get(company) ||
      (checkpoint && checkpoint.cache.manifestRangePlan(checkpoint.run, fromDate, toDate)) ||
      initialManifestRanges(fromDate, toDate, manifestNow);
    const persist = () => {
      manifestRanges.set(company, ranges);
      if (checkpoint)
        checkpoint.cache.saveManifestRangePlan(checkpoint.run, fromDate, toDate, ranges);
    };
    persist();
    let indexed = 0;
    const indexedIds = new Set();
    function accept(rows) {
      for (const row of rows) {
        if (indexedIds.has(row.id))
          throw Object.assign(
            new Error(
              "The same voucher appeared in multiple date ranges. Sync stopped before inflating the count; saved chunks are preserved.",
            ),
            { code: "TALLY_DUPLICATE_MANIFEST_ID" },
          );
        indexedIds.add(row.id);
      }
      indexed = indexedIds.size;
    }
    async function readRange(from, to) {
      checkpoint?.onProgress({
        phase: "indexing",
        completed: 0,
        total: null,
        index_from: from,
        index_to: to,
        indexed_vouchers: indexed,
      });
      try {
        const rows = parseCacheManifest(
          await request(
            buildCacheManifestRequest(company, from, to),
            `voucher manifest ${from}–${to}`,
          ),
          { fromDate: from, toDate: to },
        );
        accept(rows);
        checkpoint?.onProgress({
          phase: "indexing",
          completed: 0,
          total: null,
          index_from: from,
          index_to: to,
          indexed_vouchers: indexed,
        });
        return rows;
      } catch (error) {
        if (!["TALLY_RESPONSE_TOO_LARGE", "TALLY_TIMEOUT"].includes(error.code)) throw error;
        // A timed-out read may still be finishing in Tally. Back off before a smaller read.
        const backoff =
          error.code === "TALLY_TIMEOUT" ? Math.max(batchDelayMs, 1000) : batchDelayMs;
        if (backoff) await delay(backoff, undefined, { signal });
        const split = splitSyncDateRange(from, to);
        if (split) {
          const position = ranges.findIndex((range) => range[0] === from && range[1] === to);
          if (position < 0)
            throw new Error(
              "Voucher range checkpoint is inconsistent. Previous snapshot is preserved.",
            );
          ranges = [...ranges.slice(0, position), ...split, ...ranges.slice(position + 1)];
          persist();
          const rows = [];
          for (const [start, end] of split) rows.push(...(await readRange(start, end)));
          return rows;
        }
        const rows = await readIdBatches(
          company,
          "Voucher",
          from,
          to,
          (ids) => buildCacheManifestRequest(company, from, to, ids),
          (xml) => parseCacheManifest(xml, { fromDate: from, toDate: to }),
          "single-day voucher manifest",
        );
        accept(rows);
        return rows;
      }
    }
    const rows = [];
    for (const [from, to] of [...ranges]) {
      rows.push(...(await readRange(from, to)));
    }
    if (new Set(rows.map((row) => row.id)).size !== rows.length) {
      throw new Error(
        "Tally changed while reading voucher manifest ranges. Duplicate IDs found; sync will retry.",
      );
    }
    persist();
    return rows;
  }
  return {
    openingSnapshot: async (company, ledgers, fromDate) => {
      const opened = [];
      const bills = [];
      for await (const { rows, completed } of readSyncBatches(ledgers, {
        signal,
        delayMs: batchDelayMs,
        batchSize: 100,
        read: async (batch) => {
          const result = parseOpeningBalances(
            await request(
              buildOpeningBalancesRequest(company, batch, booksFrom(company), fromDate),
              "opening ledger balances",
            ),
            batch,
            { fromDate, booksFrom: booksFrom(company) },
          );
          const pending = result.flatMap((row) => row.opening_bills);
          return [{ ledgers: result.map(({ opening_bills, ...row }) => row), bills: pending }];
        },
        describe: (row) => `Opening snapshot for ledger '${row.name}'`,
      })) {
        opened.push(...rows[0].ledgers);
        bills.push(...rows[0].bills);
        checkpoint?.onProgress({
          phase: "opening",
          unit: "opening balances",
          completed,
          total: ledgers.length,
        });
      }
      const byLedger = new Map(opened.map((row) => [row.name, row]));
      const historyBills = [];
      async function readRange(from, to) {
        let movements, allocations;
        try {
          movements = parseOpeningHistory(
            await request(
              buildOpeningHistoryRequest(company, from, to),
              `opening ledger summary ${from}–${to}`,
            ),
            opened,
            { from, to, nonPostingTypes: nonPostingTypes.get(company) },
          );
          allocations = parseOpeningHistory(
            await request(
              buildOpeningHistoryRequest(company, from, to, true),
              `opening bill summary ${from}–${to}`,
            ),
            opened,
            { from, to, bills: true, nonPostingTypes: nonPostingTypes.get(company) },
          );
        } catch (error) {
          const split = splitSyncDateRange(from, to);
          if (!split || !["TALLY_TIMEOUT", "TALLY_RESPONSE_TOO_LARGE"].includes(error.code))
            throw error;
          await delay(
            Math.max(batchDelayMs, error.code === "TALLY_TIMEOUT" ? 1000 : 0),
            undefined,
            { signal },
          );
          for (const [start, end] of split) await readRange(start, end);
          return;
        }
        for (const row of movements) byLedger.get(row.ledger_name).opening_cents += row.movement;
        historyBills.push(...allocations);
        if (checkpoint)
          checkpoint.cache.saveMasterCheckpointRows(checkpoint.run, "OpeningHistory", [
            {
              id: `${from}-${to}`,
              signature: JSON.stringify([movements, allocations]),
              row: { from, to, movements, allocations },
            },
          ]);
        checkpoint?.onProgress({
          phase: "opening",
          index_from: from,
          index_to: to,
          completed: 0,
          total: null,
          unit: "opening history",
        });
        if (batchDelayMs) await delay(batchDelayMs, undefined, { signal });
      }
      if (fromDate.replaceAll("-", "") > booksFrom(company))
        for (const [from, to] of initialManifestRanges(
          booksFrom(company),
          openingCutoff(fromDate),
          manifestNow,
        ))
          await readRange(from, to);
      const pending = carryForwardBills(bills, historyBills);
      return {
        ledgers: opened,
        bills: pending.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      };
    },
    setCheckpoint: (run, cache, onProgress) => {
      checkpoint = { run, cache, onProgress };
    },
    companies: async () => {
      companies = parseCacheCompanies(await request(buildCacheCompaniesRequest(), "company list"));
      return companies;
    },
    stockItems: (company) =>
      readMasters(
        company,
        "StockItem",
        undefined,
        (ids) => buildCacheStockItemsRequest(company, ids),
        parseCacheStockItems,
        "stock item masters",
      ),
    ledgers: async (company) => {
      nonPostingTypes.set(
        company,
        parseCacheVoucherTypes(
          await request(buildCacheVoucherTypesRequest(company), "voucher types"),
        ),
      );
      return readMasters(
        company,
        "Ledger",
        booksFrom(company),
        (ids) => buildCacheLedgersRequest(company, booksFrom(company), ids),
        parseCacheLedgers,
        "ledger masters",
      );
    },
    manifest: readManifest,
    vouchers: async (company, manifest) => {
      const rows = parseCacheVoucherBatch(
        await request(
          buildCacheVoucherBatchRequest(
            company,
            manifest.map((row) => row.id),
            from_date ? from_date.replaceAll("-", "") : booksFrom(company),
            to_date ? to_date.replaceAll("-", "") : undefined,
          ),
          "voucher details",
        ),
        manifest,
        nonPostingTypes.get(company),
      );
      const start =
        from_date ||
        `${booksFrom(company).slice(0, 4)}-${booksFrom(company).slice(4, 6)}-${booksFrom(company).slice(6)}`;
      if (rows.some((row) => row.date < start || row.date > (to_date || "2099-12-31")))
        throw Object.assign(
          new Error(
            "Tally voucher moved outside the selected sync period. Previous snapshot and saved chunks are preserved.",
          ),
          { code: "TALLY_VOUCHER_RANGE_MISMATCH" },
        );
      return rows;
    },
  };
}
