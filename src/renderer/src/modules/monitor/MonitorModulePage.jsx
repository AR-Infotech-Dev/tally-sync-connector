import Icon from "../../components/Icon.jsx";
import ActivityTable from "./components/ActivityTable.jsx";
import MonitorSidePanel from "./components/MonitorSidePanel.jsx";
import StatusStrip from "./components/StatusStrip.jsx";
import { getConnectionPill } from "../../utils/connectionStatus.js";

export default function MonitorModulePage({ config, status, activity, tallyStatus, onOpenSettings, onOpenLogs, onConnect, onTestTally, onClear }) {
  const connection = getConnectionPill(status);
  return <div className="module-page monitor-page">
    <div className="monitor-heading"><div><p className="eyebrow">BACKGROUND SERVICE</p><h1>Connector Monitor</h1><p>Watch requests as the Connector fetches, builds XML, and sends entries to Tally.</p></div><div className="monitor-heading-actions"><span className={`connection-pill ${connection.tone}`} title={status.message}><i />{connection.label}</span><button className="button button-outline" type="button" onClick={onOpenSettings}><Icon name="settings" size={15}/>Configuration</button></div></div>
    <StatusStrip status={status} config={config} tallyStatus={tallyStatus}/>
    <div className="monitor-grid"><ActivityTable items={activity} onOpenLogs={onOpenLogs} onClear={onClear}/><MonitorSidePanel config={config} status={status} tallyStatus={tallyStatus} activity={activity} onOpenSettings={onOpenSettings} onConnect={onConnect} onTestTally={onTestTally}/></div>
    <div className="monitor-info"><span><Icon name="check" size={14}/> Connector runs in the background while connected</span><span>Activity is stored locally for {config.logRetentionDays || 30} days</span></div>
  </div>;
}
