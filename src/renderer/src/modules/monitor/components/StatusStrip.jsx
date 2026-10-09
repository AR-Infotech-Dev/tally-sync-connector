import Icon from "../../../components/Icon.jsx";
import { getRegistrationLabel, getRegistrationState, getSocketLabel } from "../../../utils/connectionStatus.js";

function StatusCell({ icon, title, value, ok = false, detail, tone = "" }) {
  return <div className="status-strip-cell"><span className={`strip-indicator ${ok ? "ok" : ""} ${tone}`}><Icon name={icon} size={17} /></span><div><small>{title}</small><strong>{value}</strong>{detail && <span title={detail}>{detail}</span>}</div></div>;
}

function formatTime(value) {
  if (!value) return "Not received yet";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function StatusStrip({ status, config, tallyStatus }) {
  const registrationState = getRegistrationState(status);
  const registrationTone = registrationState === "registered" ? "" : registrationState === "failed" ? "error" : registrationState === "pending" ? "pending" : "";
  return <section className="status-strip">
    <StatusCell icon="server" title="Socket transport" value={getSocketLabel(status)} ok={status.socketConnected} tone={!status.socketConnected && status.state === "error" ? "error" : ""} detail={config.serverUrl || "Set server URL in settings"} />
    <StatusCell icon="settings" title="Connector registration" value={getRegistrationLabel(status)} ok={registrationState === "registered"} tone={registrationTone} detail={status.socketId ? `Socket ID ${status.socketId}` : status.message || "Waiting for a socket connection"} />
    <StatusCell icon="tally" title="Tally" value={tallyStatus?.ok ? "Connected" : "Not checked"} ok={tallyStatus?.ok} detail={config.tallyCompany || config.tallyUrl || "Configure Tally"} />
    <StatusCell icon="settings" title="Company" value={config.tallyCompany || "Not selected"} detail={`Client ${config.clientId || "not registered"}`} />
    <StatusCell icon="clock" title="Last server heartbeat" value={formatTime(status.lastHeartbeatAt)} detail={registrationState === "registered" ? "Server acknowledged the socket" : "Available after registration"} />
  </section>;
}
