import { useEffect, useState } from "react";
import { initialSyncValues } from "../data/module.schema.js";
import {
  discoverSyncCompanies,
  startCompanySync,
  pauseCompanySync,
} from "../services/sync.service.js";
import { syncPayload, validateSync, categorySelection } from "../utils/sync.js";

export function useSyncModule({ status, sync }) {
  const [formData, setFormData] = useState(initialSyncValues);
  const [errors, setErrors] = useState({});
  const [companies, setCompanies] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registered = status.registrationState === "registered";
  const run = async (action) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = () =>
    run(async () => {
      const result = await discoverSyncCompanies();
      if (!result.ok) throw new Error("Tally is unavailable. Open the company and retry.");
      setCompanies(result.companies || []);
    });
  useEffect(() => {
    if (registered && !sync.running) void refresh();
  }, [registered]);
  const change = (key, value) => {
    setFormData((current) => ({ ...current, [key]: value }));
    setErrors({});
  };
  const toggle = (key, checked) =>
    setFormData((current) => ({
      ...current,
      components: categorySelection(current.components, key, checked),
    }));
  const start = () => {
    const validation = validateSync(formData, companies);
    setErrors(validation);
    if (Object.keys(validation).length) return;
    return run(() => startCompanySync(syncPayload(formData)));
  };
  const resume = (checkpoint) =>
    run(async () => {
      const next = {
        ...formData,
        company_guid: checkpoint.guid,
        components: checkpoint.components,
        batch_size: checkpoint.batch_size,
        from_date: checkpoint.from_date || formData.from_date,
        to_date: checkpoint.to_date || formData.to_date,
      };
      setFormData(next);
      await startCompanySync(syncPayload(next));
    });
  return {
    formData,
    errors,
    companies,
    busy,
    message,
    registered,
    change,
    toggle,
    refresh,
    start,
    resume,
    pause: () => run(pauseCompanySync),
  };
}
