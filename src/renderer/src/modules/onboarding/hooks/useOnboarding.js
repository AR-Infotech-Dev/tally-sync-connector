import { useState } from "react";
import { initialOnboardingValues } from "../data/module.schema.js";
import { activateConnector, saveOnboarding, testTally } from "../services/onboarding.service.js";
import { validateActivation, availableCompanies } from "../utils/onboarding.js";

export function useOnboarding({ config, onSaved, onConnect, onComplete }) {
  const [formData, setFormData] = useState({
    ...initialOnboardingValues,
    tallyUrl: config.tallyUrl,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [companies, setCompanies] = useState([]);
  const [started, setStarted] = useState(
    Boolean(config.connectorKey && config.onboardingSyncStarted),
  );
  const step = !config.connectorKey ? 0 : started ? 2 : 1;
  const change = (name, value) => {
    setFormData((current) => ({ ...current, [name]: value }));
    setErrors({});
    setMessage("");
    if (name === "tallyUrl") setCompanies([]);
  };
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
  const activate = () => {
    const error = validateActivation(formData.activationCode);
    if (error) {
      setErrors({ activationCode: error });
      return;
    }
    return run(async () => {
      const saved = await activateConnector({
        serverUrl: config.serverUrl,
        activationCode: formData.activationCode.trim(),
      });
      onSaved(saved);
      setFormData((current) => ({ ...current, activationCode: "" }));
    });
  };
  const discover = () =>
    run(async () => {
      let url;
      try {
        url = new URL(formData.tallyUrl);
      } catch {
        throw new Error("Enter a valid Tally URL.");
      }
      if (!["http:", "https:"].includes(url.protocol))
        throw new Error("Enter an HTTP or HTTPS Tally URL.");
      const saved = await saveOnboarding({
        ...config,
        tallyUrl: formData.tallyUrl,
        onboardingPending: true,
      });
      onSaved(saved);
      const result = await testTally();
      if (!result.ok)
        throw new Error(
          "Tally is unreachable. Open TallyPrime and enable its HTTP server, then retry.",
        );
      const names = availableCompanies(result);
      setCompanies(names);
      if (!names.length)
        throw new Error("No companies are open in Tally. Open your company and test again.");
    });
  const startSync = () => {
    if (!companies.length) {
      setErrors({ company: "Test Tally and open at least one company." });
      return;
    }
    return run(async () => {
      const saved = await saveOnboarding({
        ...config,
        tallyUrl: formData.tallyUrl,
        onboardingSyncStarted: true,
        onboardingPending: true,
      });
      onSaved(saved);
      await onConnect();
      setStarted(true);
    });
  };
  const finish = () =>
    run(async () => {
      const saved = await saveOnboarding({ ...config, onboardingPending: false });
      onSaved(saved);
      onComplete();
    });
  const retry = () => run(onConnect);
  return {
    formData,
    errors,
    busy,
    message,
    companies,
    step,
    change,
    activate,
    discover,
    startSync,
    finish,
    retry,
    retest: () => {
      setStarted(false);
      setCompanies([]);
    },
  };
}
