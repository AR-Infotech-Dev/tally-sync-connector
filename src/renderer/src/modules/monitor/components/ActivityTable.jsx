import Icon from "../../../components/Icon.jsx";

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ActivityTable({ items, onOpenLogs, onClear }) {
  return <section className="panel activity-table-panel">
    <div className="panel-heading"><div><h2>Connector Activity</h2><p>Live processing events from the background service</p></div><div className="panel-actions"><button className="button button-quiet" type="button" onClick={onClear}>Clear</button><button className="button button-outline" type="button" onClick={onOpenLogs}>View logs <Icon name="logs" size={15} /></button></div></div>
    <div className="table-wrap"><table className="activity-table"><thead><tr><th>Time</th><th>Level</th><th>Request</th><th>Stage</th><th>Message</th></tr></thead><tbody>
      {items.length ? items.slice(0, 80).map((item, index) => {
        const level = item.status === "failed" ? "error" : item.status === "succeeded" ? "success" : "info";
        return <tr key={`${item.requestId}-${item.at}-${index}`}><td className="time-cell">{formatTime(item.at)}</td><td><span className={`level-tag ${level}`}>{level}</span></td><td className="request-cell" title={item.requestId}>{item.requestId || "—"}</td><td><span className={`stage-tag ${item.status}`}>{item.status.replaceAll("_", " ")}</span></td><td className="message-cell" title={item.message}>{item.message}</td></tr>;
      }) : <tr><td colSpan="5" className="empty-row">No connector activity yet. New sales order jobs will appear here.</td></tr>}
    </tbody></table></div>
    <div className="table-footer"><span>Showing {Math.min(items.length, 80)} recent events</span><button className="text-link" type="button" onClick={onOpenLogs}>Open full log <Icon name="refresh" size={14} /></button></div>
  </section>;
}
