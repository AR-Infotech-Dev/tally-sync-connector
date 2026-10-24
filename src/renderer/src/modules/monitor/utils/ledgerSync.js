export function formatSyncTime(value) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Not available";
}

export function getSyncPresentation(sync) {
  const labels = { idle: "Waiting to connect", paused: "Sync paused", syncing: "Sync in progress", ready: "Up to date", failed: "Sync failed", unavailable: "Status unavailable" };
  const phases = { discovering: "Finding open Tally companies…", reading: "Reading ledgers and checking voucher changes…", verifying: "Verifying data before saving the complete snapshot…", complete: "Local database is ready. Automatic sync runs every 3 minutes.", idle: "Connect the Connector to start syncing your local database.", paused: "Connect to resume automatic sync. Previously saved data is retained." };
  const completed = Math.max(0, Number(sync.completed) || 0);
  const total = sync.total === null || sync.total === undefined ? null : Math.max(0, Number(sync.total) || 0);
  const percent = sync.state === "ready" ? 100 : total > 0 ? Math.min(99, Math.round(completed / total * 100)) : null;
  return { label: labels[sync.state] || "Waiting to sync", tone: sync.state === "ready" ? "registered" : ["failed", "unavailable"].includes(sync.state) ? "error" : "connecting", percent,
    detail: sync.phase === "fetching" ? total === 0 ? "No voucher changes found. Checking the snapshot…" : `${completed.toLocaleString()} of ${total?.toLocaleString() || "…"} changed vouchers fetched for this company.` : phases[sync.phase] || "Waiting for sync status…" };
}
