import { useState } from "react";
import { registerClient } from "../services/clientRegistration.service.js";

const initialValues = { name: "", companyName: "", email: "", tallyLicenseNo: "" };

export function useClientRegistration({ serverUrl, onRegistered }) {
  const [formData, setFormData] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function update(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: "" }));
    setMessage("");
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!formData.name.trim()) nextErrors.name = "Enter your name.";
    if (!formData.companyName.trim()) nextErrors.companyName = "Enter your company name.";
    if (!/^\S+@\S+\.\S+$/.test(formData.email.trim())) nextErrors.email = "Enter a valid email address.";
    if (!formData.tallyLicenseNo.trim()) nextErrors.tallyLicenseNo = "Enter your Tally license number.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    setMessage("");
    try {
      const result = await registerClient({ serverUrl, ...formData });
      await onRegistered(result);
    } catch (error) {
      setMessage(error.message || "Registration could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return { formData, errors, busy, message, update, submit };
}
