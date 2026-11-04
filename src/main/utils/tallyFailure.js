/** Only connection-level Tally failures receive availability classification. */
export function tallyFailureResult(error) {
  const availability = ["TALLY_NOT_CONNECTED", "TALLY_TIMEOUT"].includes(error.code);
  const company = error.code?.startsWith("COMPANY_");
  if (!availability && !company && !error.tallyResult) return null;
  return {
    ...error.tallyResult,
    ...(availability || company
      ? { error_code: error.code, lookup_status: error.httpStatus || 503 }
      : {}),
  };
}
