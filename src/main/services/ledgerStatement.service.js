import { fetchLedgerStatementRequest } from "../modules/ledgers/services/ledgerStatement.api.js";

export async function fetchLedgerStatement({ config, requestId, ledgerSync }) {
  const request = await fetchLedgerStatementRequest({ config, requestId });
  if (request.transaction_type !== "ledger_statement" || !request.lookup) throw new Error("Invalid ledger statement job.");
  if (!ledgerSync) throw new Error("Local ledger database is unavailable. Update and restart the Connector.");
  return ledgerSync.statement(config, request.lookup);
}
