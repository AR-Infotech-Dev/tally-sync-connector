import { useCallback, useEffect, useMemo, useState } from "react";
import { logsModuleSchema } from "../data/module.schema.js";
import { clearActivityLogs, getActivityLogs, retrySalesOrder } from "../services/logs.service.js";

const levelFor = (item) => item.status === "failed" ? "error" : item.status === "succeeded" ? "success" : "info";

export function useLogsModule() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [actionError, setActionError] = useState("");

  const refresh = useCallback(async () => { setLogs(await getActivityLogs()); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => window.connector.onActivity((item) => {
    if (!liveUpdates) { setPendingUpdates((count) => count + 1); return; }
    setLogs((current) => [item, ...current].slice(0, logsModuleSchema.maxExportRows));
  }), [liveUpdates]);

  const filtered = useMemo(() => logs.filter((item) => {
    const itemLevel = levelFor(item);
    const time = new Date(item.at).getTime();
    const queryMatch = !search || `${item.requestId} ${item.status} ${item.message}`.toLowerCase().includes(search.toLowerCase());
    return (level === "all" || itemLevel === level) && (status === "all" || item.status === status) && queryMatch && (!from || time >= new Date(`${from}T00:00:00`).getTime()) && (!to || time <= new Date(`${to}T23:59:59`).getTime());
  }), [logs, level, status, search, from, to]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / logsModuleSchema.pageSize));
  const pageRows = filtered.slice((page - 1) * logsModuleSchema.pageSize, page * logsModuleSchema.pageSize);

  const clear = async () => { await clearActivityLogs(); setLogs([]); setSelected(null); setPage(1); setPendingUpdates(0); };
  const resumeLiveUpdates = async () => { setLiveUpdates(true); setPendingUpdates(0); await refresh(); };
  const retrySelected = async () => {
    if (!selected?.requestId || selected.status !== "failed") return;
    setRetrying(true); setActionError("");
    try {
      const result = await retrySalesOrder(selected.requestId);
      if (!result?.success) throw new Error(result?.message || "Could not retry this request.");
      setLiveUpdates(true);
      setPendingUpdates(0);
      await refresh();
      setActionError("");
    } catch (error) { setActionError(error.message || "Could not retry this request."); }
    finally { setRetrying(false); }
  };
  const exportCsv = () => {
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["Timestamp", "Level", "Request ID", "Stage", "Message"], ...filtered.map((item) => [item.at, levelFor(item), item.requestId, item.status, item.message])];
    const blob = new Blob([rows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tally-sync-connector-logs.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  return { logs, filtered, pageRows, page, pageCount, setPage, search, setSearch, level, setLevel, status, setStatus, from, setFrom, to, setTo, selected, setSelected, refresh, clear, exportCsv, liveUpdates, setLiveUpdates, pendingUpdates, resumeLiveUpdates, retrySelected, retrying, actionError };
}
