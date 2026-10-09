import { useEffect, useState } from "react";
import { saveConnectorSettings, testTallyEndpoint } from "../services/settings.service.js";

export function useSettingsModule({ config, onConnect, onSaved }) {
  const [form, setForm] = useState(config);
  const [saving, setSaving] = useState(false);
  const [testingTally, setTestingTally] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => setForm(config), [config]);

  const setField = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const reset = () => { setForm(config); setFeedback(null); };
  const save = async () => {
    setSaving(true); setFeedback(null);
    try {
      const saved = await saveConnectorSettings(form);
      setForm(saved); onSaved(saved);
      setFeedback({ kind: "success", message: "Settings saved securely." });
      return saved;
    } catch (error) {
      setFeedback({ kind: "error", message: error.message });
      throw error;
    } finally { setSaving(false); }
  };
  const connect = async () => {
    try { await save(); onConnect(); } catch { /* feedback is shown in the form */ }
  };
  const testTally = async () => {
    setTestingTally(true); setFeedback(null);
    try {
      const result = await testTallyEndpoint();
      if (!result.ok) throw new Error(`Tally returned HTTP ${result.httpStatus || "error"}.`);
      const companies = result.companies?.map((item) => item.name).filter(Boolean) || [];
      setFeedback({ kind: "success", message: companies.length ? `Tally is reachable. Open companies: ${companies.join(", ")}.` : "Tally is reachable." });
    } catch (error) { setFeedback({ kind: "error", message: error.message }); }
    finally { setTestingTally(false); }
  };

  return { form, setField, save, reset, connect, testTally, saving, testingTally, feedback };
}
