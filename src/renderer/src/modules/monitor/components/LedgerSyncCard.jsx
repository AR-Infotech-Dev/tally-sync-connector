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
      <div className="ledger-sync-metrics">
        <div>
          <strong>{Number(sync.cached_ledgers || 0).toLocaleString()}</strong>
          <span>Ledgers saved</span>
        </div>
        <div>
          <strong>{Number(sync.cached_vouchers || 0).toLocaleString()}</strong>
          <span>Vouchers saved</span>
        </div>
        <div>
          <strong>{Number(sync.cached_entries || 0).toLocaleString()}</strong>
          <span>Ledger entries saved</span>
        </div>
        <div>
          <strong>{formatSyncTime(sync.last_synced_at)}</strong>
          <span>Last successful snapshot</span>
        </div>
      </div>
      <div className="ledger-sync-footer">
        <span>
          Next sync: {sync.next_sync_at ? formatSyncTime(sync.next_sync_at) : "Connect to schedule"}
        </span>
        <span>Saved totals update after a complete company sync.</span>
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
