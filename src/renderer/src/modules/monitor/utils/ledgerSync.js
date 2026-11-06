export function formatSyncTime(value) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString([], {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Not available";
}

export function getSyncPresentation(sync) {
  const labels = {
    idle: "Manual sync ready",
    partial: "Selected masters saved",
    paused: "Sync paused",
    syncing: "Sync in progress",
    ready: "Up to date",
    failed: "Sync failed",
    unavailable: "Status unavailable",
  };
  const phases = {
    discovering: "Finding open Tally companies…",
    reading: "Reading ledgers and checking voucher changes…",
    masters_ready: "Company, ledger and stock item masters are saved. Preparing transactions…",
    opening_cached: "Using saved opening balances and pending bills. Historical scan skipped.",
    opening: `Preparing opening balances and older pending bills${sync.index_from ? ` (${sync.index_from}–${sync.index_to})` : ""}. Only historical summaries are downloaded.`,
    indexing: `Reading voucher IDs and versions in date ranges${sync.index_from ? ` (${sync.index_from}–${sync.index_to})` : ""}. ${Number(sync.indexed_vouchers || 0).toLocaleString()} IDs found. Voucher details save one chunk at a time.`,
    verifying: "Verifying data before saving the complete snapshot…",
    complete:
      sync.state === "partial"
        ? "Selected masters are ready. Complete voucher sync is required for accounting reports."
        : sync.auto_sync
          ? "Local database is ready. Automatic sync runs every 3 minutes."
          : "Complete local snapshot is ready. Start a new manual sync when needed.",
    idle: "Open Sync to select a company and start or resume its local cache.",
    paused: "Saved chunks are retained. Open Sync and resume when Tally is ready.",
  };
  const completed = Math.max(0, Number(sync.completed) || 0);
  const total =
    sync.total === null || sync.total === undefined ? null : Math.max(0, Number(sync.total) || 0);
  const percent =
    sync.state === "ready"
      ? 100
      : total > 0
        ? Math.min(99, Math.round((completed / total) * 100))
        : null;
  return {
    label: labels[sync.state] || "Waiting to sync",
    tone: ["ready", "partial"].includes(sync.state)
      ? "registered"
      : ["failed", "unavailable"].includes(sync.state)
        ? "error"
        : "connecting",
    percent,
    detail:
      sync.phase === "masters"
        ? `${completed.toLocaleString()} of ${total?.toLocaleString() || "…"} ${sync.unit || "masters"} saved; ${Number(sync.resumed || 0).toLocaleString()} reused from checkpoint.`
        : sync.phase === "fetching"
          ? total === 0
            ? "No voucher changes found. Checking the snapshot…"
            : `${completed.toLocaleString()} of ${total?.toLocaleString() || "…"} changed vouchers committed to SQLite. ${Number(sync.resumed || 0).toLocaleString()} reused from checkpoint.`
          : phases[sync.phase] || "Waiting for sync status…",
  };
}
