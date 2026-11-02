export function validateActivation(code) {
  return /^[A-Za-z0-9_-]{43}$/.test(code.trim())
    ? ""
    : "Paste the complete activation code from your registration email.";
}
export function availableCompanies(result) {
  return [...new Set((result.companies || []).map((company) => company.name).filter(Boolean))];
}
export function setupReady(status, sync, company) {
  return (
    status.registrationState === "registered" &&
    sync.state === "ready" &&
    Boolean(sync.last_synced_at) &&
    sync.company === company
  );
}
