import { useEffect, useState } from "react";
import AppLayout from "./layouts/AppLayout.jsx";
import ClientRegistrationForm from "./components/ClientRegistrationForm.jsx";
import MonitorModulePage from "./modules/monitor/MonitorModulePage.jsx";
import SettingsModulePage from "./modules/settings/SettingsModulePage.jsx";
import LogsModulePage from "./modules/logs/LogsModulePage.jsx";
import { useMonitorModule } from "./modules/monitor/hooks/useMonitorModule.js";

const initialConfig = {
  serverUrl: "http://127.0.0.1:3000", clientId: "", connectorId: "", connectorKey: "",
  tallyUrl: "http://127.0.0.1:9000", tallyCompany: "", minimizeToTray: true,
  startWithWindows: false, requestTimeoutSeconds: 30, logRetentionDays: 30,
};

export default function App() {
  const [config, setConfig] = useState(initialConfig);
  const [page, setPage] = useState("monitor");
  const [tallyStatus, setTallyStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const monitor = useMonitorModule();

  useEffect(() => {
    window.connector.loadConfig().then(setConfig).finally(() => setLoading(false));
  }, []);

  async function saveConfig(nextConfig) {
    const saved = await window.connector.saveConfig(nextConfig);
    setConfig(saved);
    return saved;
  }

  async function connect() {
    const result = await window.connector.connect();
    const currentStatus = await window.connector.getStatus();
    monitor.setStatus(result.success ? currentStatus : { ...currentStatus, message: result.message || currentStatus.message });
  }

  async function testTally() {
    try {
      const result = await window.connector.testTallyConnection();
      const nextStatus = { ...result, ok: result.ok, checkedAt: new Date().toISOString() };
      setTallyStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      const nextStatus = { ok: false, error: error.message, checkedAt: new Date().toISOString() };
      setTallyStatus(nextStatus);
      return nextStatus;
    }
  }

  async function registerClient(result) {
    const nextConfig = { ...config, serverUrl: result.serverUrl || config.serverUrl, clientId: result.clientId, connectorId: result.connectorId, connectorKey: "" };
    const saved = await saveConfig(nextConfig);
    setConfig(saved);
    monitor.setStatus({
      state: "disconnected",
      socketConnected: false,
      registrationState: "not_registered",
      message: `Client account created. Credentials were emailed to ${result.email}. Enter your Connector Key in Settings, then connect the socket.`,
    });
    setPage("settings");
  }

  async function startNewRegistration() {
    const saved = await saveConfig({ ...config, clientId: "", connectorId: "", connectorKey: "" });
    setConfig(saved);
  }

  if (loading) return <div className="loading-shell"><span className="loading-spinner"/>Loading Connector…</div>;
  if (!config.clientId) return <div className="registration-shell"><header className="registration-brand"><span className="brand-mark">TS</span><div><p className="eyebrow">TALLY SYNC</p><h1>Connector</h1></div></header><ClientRegistrationForm serverUrl={config.serverUrl || "http://127.0.0.1:3000"} onServerUrlChange={(serverUrl) => setConfig((current) => ({ ...current, serverUrl }))} onRegistered={registerClient}/><p className="registration-footer">The Connector runs on the computer where TallyPrime is installed.</p></div>;

  return <AppLayout page={page} onNavigate={setPage} status={monitor.status}>
    {page === "monitor" && <MonitorModulePage config={config} status={monitor.status} activity={monitor.activity} tallyStatus={tallyStatus} onOpenSettings={() => setPage("settings")} onOpenLogs={() => setPage("logs")} onConnect={connect} onTestTally={testTally} onClear={monitor.clearActivity}/>}
    {page === "settings" && <SettingsModulePage config={config} onConnect={connect} onSaved={setConfig} onBack={() => setPage("monitor")} onNewRegistration={startNewRegistration}/>}
    {page === "logs" && <LogsModulePage onBack={() => setPage("monitor")}/>}
  </AppLayout>;
}
