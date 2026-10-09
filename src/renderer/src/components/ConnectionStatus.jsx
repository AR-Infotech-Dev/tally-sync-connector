const labels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  registered: "Ready",
  error: "Connection error",
};

export default function ConnectionStatus({ status }) {
  return (
    <section className="status-card" aria-live="polite">
      <span className={`status-dot ${status.state}`} />
      <div><strong>{labels[status.state] || "Status"}</strong><p>{status.message}</p></div>
    </section>
  );
}
