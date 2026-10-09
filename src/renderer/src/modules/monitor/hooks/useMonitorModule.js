import { useEffect, useState } from "react";
import { loadRecentActivity } from "../services/monitor.service.js";
import { clearActivityLogs } from "../../logs/services/logs.service.js";

const initialStatus = {
  state: "disconnected",
  message: "Configure the Server and Tally connections.",
  socketConnected: false,
  registrationState: "not_registered",
  socketId: null,
  registeredAt: null,
  lastHeartbeatAt: null,
};

export function useMonitorModule() {
  const [status, setStatus] = useState(initialStatus);
  const [activity, setActivity] = useState([]);

  useEffect(() => {
    let mounted = true;
    loadRecentActivity().then((items) => { if (mounted) setActivity(items); }).catch(() => {});
    const removeStatus = window.connector.onStatus((nextStatus) => setStatus(nextStatus));
    const removeActivity = window.connector.onActivity((item) => setActivity((current) => [item, ...current].slice(0, 100)));
    window.connector.getStatus().then((currentStatus) => { if (mounted) setStatus(currentStatus); }).catch(() => {});
    return () => { mounted = false; removeStatus(); removeActivity(); };
  }, []);

  const clearActivity = async () => { await clearActivityLogs(); setActivity([]); };
  return { status, setStatus, activity, clearActivity };
}
