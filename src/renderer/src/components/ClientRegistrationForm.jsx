import { useClientRegistration } from "../hooks/useClientRegistration.js";

export default function ClientRegistrationForm({ serverUrl, onServerUrlChange, onRegistered }) {
  const { formData, errors, busy, message, update, submit } = useClientRegistration({ serverUrl, onRegistered });

  return (
    <form className="config-form" onSubmit={submit} noValidate>
      <div className="form-intro">
        <h2>Register this Tally client</h2>
        <p>We will email your CRM API key and Connector credentials after registration.</p>
      </div>
      <label>Server URL<input type="url" value={serverUrl} onChange={(event) => onServerUrlChange(event.target.value)} placeholder="https://api.example.com" required /></label>
      <label>Your Name<input name="name" value={formData.name} onChange={update} autoComplete="name" required />{errors.name && <small className="field-error">{errors.name}</small>}</label>
      <label>Company Name<input name="companyName" value={formData.companyName} onChange={update} autoComplete="organization" required />{errors.companyName && <small className="field-error">{errors.companyName}</small>}</label>
      <label>Email Address<input name="email" type="email" value={formData.email} onChange={update} autoComplete="email" required />{errors.email && <small className="field-error">{errors.email}</small>}</label>
      <label>Tally License Number<input name="tallyLicenseNo" value={formData.tallyLicenseNo} onChange={update} required />{errors.tallyLicenseNo && <small className="field-error">{errors.tallyLicenseNo}</small>}</label>
      {message && <p className="form-message" role="alert">{message}</p>}
      <button className="button-primary registration-submit" type="submit" disabled={busy}>{busy ? "Registering…" : "Register Client"}</button>
    </form>
  );
}
