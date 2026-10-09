import Icon from "./Icon.jsx";
import { getRegistrationState } from "../utils/connectionStatus.js";

const navItems = [
  { id: "monitor", label: "Monitor", icon: "monitor" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "logs", label: "Logs", icon: "logs" },
];

export default function Sidebar({ page, onNavigate, status }) {
  const registrationState = getRegistrationState(status);
  const statusLabel = registrationState === "registered"
    ? "Connector registered"
    : registrationState === "pending"
      ? "Socket connected · registering"
      : registrationState === "failed"
        ? "Registration failed"
        : status.state === "connecting" ? "Connecting to socket" : "Socket offline";
  return (
    <aside className="app-sidebar">
      <div className="sidebar-brand"><span className="brand-mark">TS</span><div><strong>Tally Sync</strong><small>Connector</small></div></div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {navItems.map((item) => <button key={item.id} type="button" className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => onNavigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><span className={`status-dot ${registrationState === "registered" ? "registered" : registrationState === "failed" ? "error" : status.socketConnected ? "connected" : status.state}`} /><span>{statusLabel}</span></div>
    </aside>
  );
}
