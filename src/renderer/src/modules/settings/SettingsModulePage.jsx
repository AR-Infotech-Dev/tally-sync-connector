import Icon from "../../components/Icon.jsx";
import SettingsCard from "./components/SettingsCard.jsx";
import { useSettingsModule } from "./hooks/useSettingsModule.js";

function TextField({ label, name, value, onChange, type = "text", placeholder = "" }) {
  return <label className="settings-field"><span>{label}</span><input name={name} type={type} value={value || ""} onChange={(event) => onChange(name, event.target.value)} placeholder={placeholder} autoComplete={type === "password" ? "new-password" : "off"} /></label>;
}
function ToggleField({ label, hint, checked, onChange }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} /><i /></label>;
}

export default function SettingsModulePage({ config, onConnect, onSaved, onBack, onNewRegistration }) {
  const { form, setField, save, reset, connect, testTally, saving, testingTally, feedback } = useSettingsModule({ config, onConnect, onSaved });
  return <div className="module-page settings-page">
    <div className="page-heading"><div><p className="eyebrow">CONNECTOR CONFIGURATION</p><h1>Settings</h1><p>Manage Server, Tally, background service and log preferences.</p></div><div className="page-heading-actions"><button className="button button-quiet" type="button" onClick={onNewRegistration}>Register another client</button><button className="button button-outline" type="button" onClick={onBack}>Back to Monitor</button></div></div>
    <div className="settings-grid">
      <SettingsCard title="Server Connection" description="Credentials are stored securely on this computer.">
        <div className="settings-form-grid"><TextField label="Server URL" name="serverUrl" value={form.serverUrl} onChange={setField} placeholder="https://api.example.com"/><TextField label="Client ID" name="clientId" value={form.clientId} onChange={setField} placeholder="Client ID"/><TextField label="Connector ID" name="connectorId" value={form.connectorId} onChange={setField} placeholder="Connector ID"/><TextField label="Connector Key" name="connectorKey" type="password" value={form.connectorKey} onChange={setField} placeholder="Enter connector key"/></div>
        <button className="button button-outline" type="button" onClick={connect} disabled={saving}><Icon name="refresh" size={15}/>{saving ? "Saving…" : "Save & Connect"}</button>
      </SettingsCard>
      <SettingsCard title="Tally Connection" description="TallyPrime must be open on this computer.">
        <div className="settings-form-grid"><TextField label="Tally URL" name="tallyUrl" value={form.tallyUrl} onChange={setField} placeholder="http://127.0.0.1:9000"/><TextField label="Company name" name="tallyCompany" value={form.tallyCompany} onChange={setField} placeholder="Sai Enterprises"/></div>
        <button className="button button-outline" type="button" onClick={testTally} disabled={testingTally}><Icon name="tally" size={15}/>{testingTally ? "Checking Tally…" : "Test Tally Connection"}</button>
      </SettingsCard>
      <SettingsCard title="Background Service" description="Connector keeps processing while the window is hidden.">
        <ToggleField label="Close to system tray" hint="Keep Connector running when you close its window." checked={form.minimizeToTray} onChange={(value) => setField("minimizeToTray", value)}/>
        <ToggleField label="Start with Windows" hint="Connect to Server automatically after sign-in." checked={form.startWithWindows} onChange={(value) => setField("startWithWindows", value)}/>
      </SettingsCard>
      <SettingsCard title="Processing & Logs" description="Set safe bounds for Tally requests and local log storage.">
        <div className="settings-form-grid"><TextField label="Request timeout (seconds)" name="requestTimeoutSeconds" type="number" value={form.requestTimeoutSeconds} onChange={(key, value) => setField(key, Number(value))} placeholder="30"/><TextField label="Keep logs for (days)" name="logRetentionDays" type="number" value={form.logRetentionDays} onChange={(key, value) => setField(key, Number(value))} placeholder="30"/></div>
        <p className="settings-note">Jobs are processed one at a time. Credentials are not written to activity logs.</p>
      </SettingsCard>
    </div>
    {feedback && <p className={`settings-feedback ${feedback.kind}`} role="status">{feedback.message}</p>}
    <div className="settings-savebar"><span>Changes are saved to this Connector installation.</span><div><button className="button button-quiet" type="button" onClick={reset}>Reset</button><button className="button button-primary" type="button" onClick={() => save().catch(() => {})} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button></div></div>
  </div>;
}
