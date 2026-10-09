import Sidebar from "../components/Sidebar.jsx";
import { getConnectionPill } from "../utils/connectionStatus.js";

export default function AppLayout({ page, onNavigate, status, children }) {
  const connection = getConnectionPill(status);
  return <div className="workspace-shell"><Sidebar page={page} onNavigate={onNavigate} status={status} /><div className="workspace-main"><header className="workspace-topbar"><div><strong>Tally Sync Connector</strong><span className="topbar-caption">Background service monitor</span></div><span className={`connection-pill ${connection.tone}`} title={status.message}><i />{connection.label}</span></header><main className="workspace-content">{children}</main><footer className="workspace-footer"><span className="footer-indicator" />Service active in system tray <span className="footer-divider">|</span> Tally Sync Connector</footer></div></div>;
}
