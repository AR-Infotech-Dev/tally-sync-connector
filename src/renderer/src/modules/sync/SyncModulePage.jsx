import { useSyncModule } from "./hooks/useSyncModule.js";
import { syncCategories, batchSizes } from "./data/module.schema.js";
import LedgerSyncCard from "../monitor/components/LedgerSyncCard.jsx";
import { formatSyncTime } from "../monitor/utils/ledgerSync.js";
import SettingsCard from "../settings/components/SettingsCard.jsx";
import { syncCategoryLabel } from "./utils/sync.js";

export default function SyncModulePage({ status, sync }) {
  const form = useSyncModule({ status, sync });
  const locked = form.busy || sync.running;
  const checkpoints = sync.checkpoints || [];
  return (
    <div className="module-page sync-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">LOCAL DATABASE</p>
          <h1>Company Sync</h1>
          <p>Select a company and the data to cache on this computer.</p>
        </div>
        <button
          className="button button-outline"
          disabled={locked || !form.registered}
          onClick={form.refresh}
        >
          Refresh companies
        </button>
      </div>
      {!form.registered && (
        <p className="settings-feedback error">
          Connect the Connector to Server before starting a sync.
        </p>
      )}
      <SettingsCard
        title="Sync options"
        description="Choose the company and data for this local sync."
      >
        <div className="settings-form-grid">
          <label className="settings-field">
            <span>Company</span>
            <select
              disabled={locked}
              value={form.formData.company_guid}
              onChange={(event) => form.change("company_guid", event.target.value)}
              aria-invalid={Boolean(form.errors.company_guid)}
            >
              <option value="">Select an open company</option>
              {form.companies.map((company) => (
                <option key={company.guid} value={company.guid}>
                  {company.company_id ? `${company.company_id} · ` : ""}
                  {company.name}
                </option>
              ))}
            </select>
            {form.errors.company_guid && (
              <small className="field-error">{form.errors.company_guid}</small>
            )}
          </label>
          <div className="settings-field">
            <span>Report readiness</span>
            <p className="settings-note">
              Ledger statements, outstanding and group reports need a complete voucher snapshot. A
              masters-only sync does not replace it.
            </p>
          </div>
        </div>
        <div className="settings-form-grid">
          {[
            { key: "from_date", label: "From Date" },
            { key: "to_date", label: "To Date" },
          ].map(({ key, label }) => (
            <label className="settings-field" key={key}>
              <span>{label}</span>
              <input
                type="date"
                disabled={locked}
                value={form.formData[key]}
                onChange={(event) => form.change(key, event.target.value)}
                aria-invalid={Boolean(form.errors[key])}
              />
              {form.errors[key] && <small className="field-error">{form.errors[key]}</small>}
            </label>
          ))}
        </div>
        <p className="settings-note">
          Defaults to the current financial year (April–March). Voucher dates are inclusive. Masters
          are synced independently of this period. The first manual sync prepares opening balances
          and older pending bills. Later syncs reuse the saved opening history. Completing a
          different period replaces the company's report snapshot.
        </p>
        <label className="sync-category">
          <input
            type="checkbox"
            checked={form.formData.refresh_opening}
            disabled={locked || !form.formData.components.includes("vouchers")}
            onChange={(event) => form.change("refresh_opening", event.target.checked)}
          />
          <span>
            <strong>Refresh opening history</strong>
            <small>
              Use after changing vouchers dated before From Date, restoring company data, or
              changing old bill allocations. This can take time. Automatic sync does not check
              historical changes.
            </small>
          </span>
        </label>
        <fieldset className="sync-categories" disabled={locked}>
          <legend>Data to sync</legend>
          {syncCategories.map((category) => (
            <label className="sync-category" key={category.key}>
              <input
                type="checkbox"
                checked={form.formData.components.includes(category.key)}
                disabled={
                  category.key === "company" ||
                  (form.formData.components.includes("vouchers") &&
                    ["ledgers", "stock_items"].includes(category.key))
                }
                onChange={(event) => form.toggle(category.key, event.target.checked)}
              />
              <span>
                <strong>{category.label}</strong>
                <small>{category.hint}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="settings-form-grid">
          <label className="settings-field">
            <span>Maximum vouchers per chunk</span>
            <select
              disabled={locked}
              value={form.formData.batch_size}
              onChange={(event) => form.change("batch_size", event.target.value)}
            >
              {batchSizes.map((size) => (
                <option value={size} key={size}>
                  {size}
                </option>
              ))}
            </select>
            {form.errors.batch_size && (
              <small className="field-error">{form.errors.batch_size}</small>
            )}
          </label>
          <label className="settings-field">
            <span>Pause between chunks (milliseconds)</span>
            <input
              type="number"
              min="250"
              max="5000"
              disabled={locked}
              value={form.formData.delay_ms}
              onChange={(event) => form.change("delay_ms", event.target.value)}
            />
            {form.errors.delay_ms && <small className="field-error">{form.errors.delay_ms}</small>}
          </label>
        </div>
        <p className="settings-note">
          Each successful chunk is saved to SQLite. Start again or resume after interruption; saved
          records are revalidated and reused. Large responses automatically use smaller chunks. This
          selection only controls local sync.
        </p>
        <div className="page-heading-actions">
          <button
            className="button button-primary"
            disabled={locked || !form.registered}
            onClick={form.start}
          >
            Start / resume selected sync
          </button>
          <button
            className="button button-outline"
            disabled={form.busy || !sync.running}
            onClick={form.pause}
          >
            Pause sync
          </button>
        </div>
        {form.message && (
          <p className="settings-feedback error" role="alert">
            {form.message}
          </p>
        )}
      </SettingsCard>
      <LedgerSyncCard sync={sync} />
      <SettingsCard
        title="Saved checkpoints"
        description="Resume an unfinished sync after opening its company in Tally."
      >
        {!checkpoints.length && (
          <p className="settings-note">
            No unfinished syncs. Completed snapshots remain in the local database.
          </p>
        )}
        <div className="sync-checkpoints">
          {checkpoints.map((checkpoint) => (
            <div className="sync-checkpoint" key={checkpoint.stage}>
              <div>
                <strong>{checkpoint.company}</strong>
                <p className="settings-note">
                  {checkpoint.components.map(syncCategoryLabel).join(", ")} ·{" "}
                  {checkpoint.saved_vouchers.toLocaleString()} vouchers ·{" "}
                  {Number(checkpoint.saved_masters || 0).toLocaleString()} masters saved ·{" "}
                  {checkpoint.state}
                </p>
                <small>{formatSyncTime(checkpoint.updated_at)}</small>
                {checkpoint.from_date && (
                  <p className="settings-note">
                    {checkpoint.from_date} to {checkpoint.to_date}
                  </p>
                )}
                {checkpoint.error && <p className="field-error">{checkpoint.error}</p>}
                {checkpoint.company_sync_status === "identity_upgrade_required" && (
                  <p className="field-error">
                    This older cache used GUID-only identification. Select the company above and
                    start a new sync to keep branch data separate. Existing data is retained.
                  </p>
                )}
              </div>
              <button
                className="button button-outline"
                disabled={
                  locked ||
                  !form.registered ||
                  checkpoint.company_sync_status === "identity_upgrade_required" ||
                  !form.companies.some((company) => company.guid === checkpoint.guid)
                }
                onClick={() => form.resume(checkpoint)}
              >
                Resume
              </button>
            </div>
          ))}
        </div>
      </SettingsCard>
      <SettingsCard
        title="Company data readiness"
        description="Counts and last publication time for each data category."
      >
        <div className="sync-checkpoints">
          {form.companies.map((company) => (
            <div className="sync-checkpoint" key={company.guid}>
              <strong>{company.name}</strong>
              <span className="settings-note">
                {(sync.components || [])
                  .filter((row) => row.guid === company.guid)
                  .map(
                    (row) =>
                      `${syncCategoryLabel(row.component)}: ${row.record_count}${row.from_date ? ` · ${row.from_date} to ${row.to_date}` : ""} · ${formatSyncTime(row.updated_at)}`,
                  )
                  .join(" · ") || "Not synced yet"}
              </span>
            </div>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
