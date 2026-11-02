import { useEffect, useState } from "react";
import { loadLedgerSyncStatus } from "../services/monitor.service.js";
import { initialLedgerSync, monitorModuleSchema } from "../data/module.schema.js";

export function useLedgerSyncStatus() {
  const [sync, setSync] = useState(initialLedgerSync);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const status = await loadLedgerSyncStatus();
        if (mounted) setSync(status);
      } catch (error) {
        if (mounted)
          setSync((current) => ({
            ...current,
            state: "unavailable",
            error: `Sync status unavailable: ${error?.message || "Restart the Connector main process."}`,
          }));
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, monitorModuleSchema.syncPollIntervalMs);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  return sync;
}
