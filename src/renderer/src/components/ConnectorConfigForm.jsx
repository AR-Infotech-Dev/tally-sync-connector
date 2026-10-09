import { useEffect, useState } from "react";

export default function ConnectorConfigForm({ config, onSave, onConnect }) {
  const [form, setForm] = useState(config);
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(config), [config]);

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try { await onSave(form); } finally { setBusy(false); }
  }

  async function checkConnection() {
    setBusy(true);
    try { await onSave(form); await onConnect(); } finally { setBusy(false); }
  }

  return (
    <form className="config-form" onSubmit={save}>
      <label>Server URL<input name="serverUrl" type="url" value={form.serverUrl || ""} onChange={update} placeholder="https://api.example.com" required /></label>
      <label>Client ID<input name="clientId" value={form.clientId || ""} onChange={update} placeholder="CLIENT_001" required /></label>
      <label>Connector ID<input name="connectorId" value={form.connectorId || ""} onChange={update} placeholder="CONNECTOR_001" required /></label>
      <label>Connector Key<input name="connectorKey" type="password" value={form.connectorKey || ""} onChange={update} autoComplete="new-password" required /></label>
      <label>Tally URL<input name="tallyUrl" type="url" value={form.tallyUrl || "http://127.0.0.1:9000"} onChange={update} placeholder="http://127.0.0.1:9000" required /></label>
      <label>Tally Company Name<input name="tallyCompany" value={form.tallyCompany || ""} onChange={update} placeholder="Company name in Tally" /></label>
      <div className="form-actions">
        <button className="button-secondary" type="submit" disabled={busy}>Save Configuration</button>
        <button className="button-primary" type="button" onClick={checkConnection} disabled={busy}>Check Connection</button>
      </div>
    </form>
  );
}
