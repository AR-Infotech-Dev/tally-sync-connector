import Icon from "../../../components/Icon.jsx";
import { formatSyncTime, getSyncPresentation } from "../utils/ledgerSync.js";

export default function LedgerSyncCard({ sync }) {
  const view = getSyncPresentation(sync);
  return (
    <section className="panel ledger-sync-card" aria-label="Ledger database sync">
      <div className="ledger-sync-heading">
        <div className="side-panel-title">
          <Icon name="refresh" size={17} />
          <h2>Ledger Database Sync</h2>
        </div>
        <span className={`connection-pill ${view.tone}`}>
          <i />
          {view.label}
        </span>
      </div>
      <div className="ledger-sync-summary">
        <div>
          <strong>{sync.company || "Local accounting database"}</strong>
          <p>{view.detail}</p>
          {sync.company_total > 1 && (
            <small>
              Company {sync.company_index} of {sync.company_total}
            </small>
          )}
        </div>
        {sync.state === "syncing" && (
          <strong className="ledger-sync-percent">
            {view.percent === null ? "Working…" : `${view.percent}%`}
          </strong>
        )}
      </div>
      {sync.state === "syncing" && (
        <progress
          aria-label="Current company sync progress"
          max="100"
          value={view.percent ?? undefined}
        />
      )}
      {sync.error && (
        <p className="ledger-sync-error" role="status">
          {sync.error}
        </p>
      )}
      {sync.active_checkpoint && (
        <>
          <p className="settings-note">
            <strong>Saved locally — {sync.active_checkpoint.company}</strong>. These chunks survive
            failure and restart.
          </p>
          <div className="ledger-sync-metrics" aria-label="Locally saved checkpoint counts">
            <div>
              <strong>{Number(sync.active_checkpoint.saved_masters || 0).toLocaleString()}</strong>
              <span>Masters saved locally</span>
            </div>
            <div>
              <strong>{Number(sync.active_checkpoint.saved_vouchers || 0).toLocaleString()}</strong>
              <span>Vouchers saved locally</span>
            </div>
            <div>
              <strong>{Number(sync.active_checkpoint.saved_entries || 0).toLocaleString()}</strong>
              <span>Ledger entries saved locally</span>
            </div>
            <div>
              <strong>{sync.active_checkpoint.state}</strong>
              <span>Checkpoint status</span>
            </div>
          </div>
        </>
      )}
      <p className="settings-note">Report-ready snapshot</p>
      <div className="ledger-sync-metrics">
        <div>
          <strong>{Number(sync.cached_ledgers || 0).toLocaleString()}</strong>
          <span>Report-ready ledgers</span>
        </div>
        <div>
          <strong>{Number(sync.cached_vouchers || 0).toLocaleString()}</strong>
          <span>Report-ready vouchers</span>
        </div>
        <div>
          <strong>{Number(sync.cached_entries || 0).toLocaleString()}</strong>
          <span>Report-ready ledger entries</span>
        </div>
        <div>
          <strong>{formatSyncTime(sync.last_synced_at)}</strong>
          <span>Last successful snapshot</span>
        </div>
      </div>
      <div className="ledger-sync-footer">
        <span>
          Next sync: {sync.next_sync_at ? formatSyncTime(sync.next_sync_at) : "Manual — open Sync"}
        </span>
        <span>Chunks save immediately. Report-ready totals update after verification.</span>
      </div>
      {sync.companies?.length > 1 && (
        <div className="ledger-sync-companies">
          {sync.companies.map((company) => (
            <div key={company.name}>
              <strong>{company.name}</strong>
              <span>
                {company.vouchers.toLocaleString()} vouchers ·{" "}
                {formatSyncTime(company.last_synced_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
