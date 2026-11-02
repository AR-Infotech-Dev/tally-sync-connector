export const monitorModuleSchema = {
  syncPollIntervalMs: 2000,
  title: "Connector Activity",
  recentLogLimit: 100,
  summaryStatuses: ["fetching", "building_xml", "pushing", "succeeded", "failed"],
};

export const initialLedgerSync = {
  state: "idle",
  phase: "idle",
  company: null,
  total: null,
  completed: 0,
  cached_ledgers: 0,
  cached_vouchers: 0,
  cached_entries: 0,
  last_synced_at: null,
  next_sync_at: null,
  companies: [],
  error: null,
};
