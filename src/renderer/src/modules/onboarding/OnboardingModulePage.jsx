import CompanyList from "../../components/CompanyList.jsx";
import { useOnboarding } from "./hooks/useOnboarding.js";
import { onboardingSteps } from "./data/module.schema.js";
import { setupReady } from "./utils/onboarding.js";
import LedgerSyncCard from "../monitor/components/LedgerSyncCard.jsx";

export default function OnboardingModulePage({
  config,
  status,
  sync,
  onSaved,
  onConnect,
  onComplete,
  onManual,
}) {
  const form = useOnboarding({ config, onSaved, onConnect, onComplete });
  const ready = setupReady(status, sync);
  return (
    <div className="module-page onboarding-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GET STARTED</p>
          <h1>Set up your Connector</h1>
          <p>Activate, test Tally and complete the first sync.</p>
        </div>
        <button className="button button-outline" onClick={onManual}>
          Manual setup / Settings
        </button>
      </div>
      <ol className="onboarding-steps">
        {onboardingSteps.map((label, index) => (
          <li key={label} aria-current={form.step === index ? "step" : undefined}>
            <strong>{index + 1}</strong>
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <section className="settings-card">
        {form.step === 0 && (
          <>
            <h2>Paste your activation code</h2>
            <p className="settings-note">
              Check your registration email. This code sets up the Connector automatically. Your
              application API key is separate.
            </p>
            <p className="settings-note">Server: {config.serverUrl}</p>
            <label className="settings-field">
              Activation code
              <input
                type="password"
                autoComplete="off"
                value={form.formData.activationCode}
                onChange={(e) => form.change("activationCode", e.target.value)}
                aria-invalid={Boolean(form.errors.activationCode)}
              />
              {form.errors.activationCode && (
                <small className="field-error">{form.errors.activationCode}</small>
              )}
            </label>
            <button className="button button-primary" disabled={form.busy} onClick={form.activate}>
              {form.busy ? "Activating…" : "Activate Connector"}
            </button>
          </>
        )}
        {form.step === 1 && (
          <>
            <h2>Connect to TallyPrime</h2>
            <p className="settings-note">
              Open TallyPrime and the companies you want to use. Choose what to sync in the Sync
              menu. API requests select a company using company_id.
            </p>
            <label className="settings-field">
              Tally URL
              <input
                value={form.formData.tallyUrl}
                onChange={(e) => form.change("tallyUrl", e.target.value)}
              />
            </label>
            <button className="button button-outline" disabled={form.busy} onClick={form.discover}>
              {form.busy ? "Checking…" : "Test & find companies"}
            </button>
            {form.companies.length > 0 && (
              <>
                <CompanyList companies={form.companies} />
                <button
                  className="button button-primary"
                  disabled={form.busy}
                  onClick={form.startSync}
                >
                  Connect Connector
                </button>
              </>
            )}
          </>
        )}
        {form.step === 2 && (
          <>
            <h2>{ready ? "Your Connector is ready" : "Complete your first sync"}</h2>
            <p className="settings-note">
              {status.registrationState === "registered"
                ? "Connected to Server."
                : status.message || "Waiting for Server connection."}{" "}
              Keep Tally open until the sync completes.
            </p>
            <LedgerSyncCard sync={sync} />
            <div className="page-heading-actions">
              <button className="button button-outline" disabled={form.busy} onClick={form.retest}>
                Test Tally again
              </button>
              <button className="button button-outline" disabled={form.busy} onClick={form.retry}>
                Retry connection & sync
              </button>
              <button className="button button-primary" disabled={form.busy} onClick={form.finish}>
                Open Sync
              </button>
            </div>
          </>
        )}
        {form.message && (
          <p className="settings-feedback error" role="alert">
            {form.message}
          </p>
        )}
      </section>
      <section className="settings-card">
        <h2>Using your API credentials</h2>
        <p className="settings-note">
          Use X-Client-ID and X-API-Key from your email in your backend or Postman. The API Key is
          the secret; no extra API Secret is required. Connector activation never needs your API
          key.
        </p>
      </section>
    </div>
  );
}
