import { createTallyHttpTransport } from "../utils/tally-connector-engine/transport/httpTransport.js";
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
} from "../utils/tally-connector-engine/modules/ledgers/ledgerCache.mapper.js";

export function createLedgerSyncSource(config, signal) {
  let companies = [];
  const nonPostingTypes = new Map();
  const booksFrom = (name) => companies.find((company) => company.name === name)?.books_from;
  const transport = createTallyHttpTransport();
  async function request(xml) {
    signal.throwIfAborted();
    const response = await transport.postXml({ url: config.tallyUrl }, xml, {
      timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000,
      signal,
    });
    signal.throwIfAborted();
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Tally ledger sync returned HTTP ${response.status}.`);
    return response.body;
  }
  return {
    companies: async () => {
      companies = parseCacheCompanies(await request(buildCacheCompaniesRequest()));
      return companies;
    },
    stockItems: async (company) =>
      parseCacheStockItems(await request(buildCacheStockItemsRequest(company))),
    ledgers: async (company) => {
      nonPostingTypes.set(
        company,
        parseCacheVoucherTypes(await request(buildCacheVoucherTypesRequest(company))),
      );
      return parseCacheLedgers(
        await request(buildCacheLedgersRequest(company, booksFrom(company))),
      );
    },
    manifest: async (company) =>
      parseCacheManifest(await request(buildCacheManifestRequest(company, booksFrom(company)))),
    vouchers: async (company, manifest) =>
      parseCacheVoucherBatch(
        await request(
          buildCacheVoucherBatchRequest(
            company,
            manifest.map((row) => row.id),
            booksFrom(company),
          ),
        ),
        manifest,
        nonPostingTypes.get(company),
      ),
  };
}
