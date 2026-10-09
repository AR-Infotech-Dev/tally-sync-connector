import Icon from "../../../components/Icon.jsx";
import { getRegistrationLabel, getRegistrationState, getSocketLabel } from "../../../utils/connectionStatus.js";

function Detail({ label, value, ok }) { return <div className="connection-detail"><span>{label}</span><strong className={ok === true ? "text-success" : ok === false ? "text-muted" : ""}>{value || "—"}</strong></div>; }

export default function MonitorSidePanel({ config, status, tallyStatus, activity, onOpenSettings, onConnect, onTestTally }) {
  const successCount = activity.filter((item) => item.status === "succeeded").length;
  const failedCount = activity.filter((item) => item.status === "failed").length;
  const registrationState = getRegistrationState(status);
  const serviceConnected = registrationState === "registered";
  const connectionText = registrationState === "pending"
    ? "Socket connected; registration pending"
    : registrationState === "failed"
      ? "Socket connected; registration failed"
      : serviceConnected ? "Connector registered with Server" : "Socket not connected";
  const dotState = serviceConnected ? "registered" : registrationState === "failed" ? "error" : status.socketConnected ? "connected" : status.state;
  return <aside className="monitor-side-panel">
    <section className="panel service-card"><div className="side-panel-title"><Icon name="settings" size={17}/><h2>Service Control</h2></div><div className="service-status-box"><span className={`status-dot ${dotState}`} /><div><strong>{connectionText}</strong><small>{status.message}</small></div></div><div className="service-actions"><button type="button" className="button button-primary" onClick={onConnect}>{status.socketConnected || status.state === "connecting" ? "Reconnect" : "Connect to Server"}</button><button type="button" className="button button-outline" onClick={onOpenSettings}>Settings</button></div></section>
    <section className="panel connection-card"><div className="side-panel-title"><Icon name="server" size={17}/><h2>Server Connection</h2></div><Detail label="Server URL" value={config.serverUrl}/><Detail label="Socket transport" value={getSocketLabel(status)} ok={status.socketConnected}/><Detail label="Connector registration" value={getRegistrationLabel(status)} ok={serviceConnected} /><Detail label="Socket ID" value={status.socketId || "Not assigned"} ok={status.socketId ? true : undefined}/><Detail label="Client ID" value={config.clientId}/></section>
    <section className="panel connection-card"><div className="side-panel-title"><Icon name="tally" size={17}/><h2>Tally Connection</h2></div><Detail label="Company" value={config.tallyCompany || "Not selected"}/><Detail label="Tally URL" value={config.tallyUrl}/><Detail label="Status" value={tallyStatus?.ok ? "Connected" : tallyStatus?.error ? "Unavailable" : "Not checked"} ok={tallyStatus?.ok}/><button type="button" className="button button-outline full-button" onClick={onTestTally}><Icon name="refresh" size={14}/>Test Tally Connection</button></section>
    <section className="panel stats-card"><div className="side-panel-title"><Icon name="monitor" size={17}/><h2>Recent Activity</h2></div><div className="stats-grid"><div><strong>{activity.length}</strong><small>Events</small></div><div><strong className="text-success">{successCount}</strong><small>Successful</small></div><div><strong className="text-error">{failedCount}</strong><small>Failed</small></div></div></section>
  </aside>;
}
