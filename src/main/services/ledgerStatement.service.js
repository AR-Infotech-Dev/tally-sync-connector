import { fetchLedgerStatementRequest } from "../modules/ledgers/services/ledgerStatement.api.js";

export async function fetchLedgerStatement({ config, requestId, ledgerSync, companyAccess }) {
  const request = await fetchLedgerStatementRequest({ config, requestId });
  if (request.transaction_type !== "ledger_statement" || !request.lookup)
    throw new Error("Invalid ledger statement job.");
  if (!ledgerSync)
    throw new Error("Local ledger database is unavailable. Update and restart the Connector.");
  return ledgerSync.statement(config, {
    ...request.lookup,
    ...(await companyAccess.resolve(request.lookup)),
  });
}

export async function fetchGroupSummary({ config, requestId, ledgerSync, companyAccess }) {
  const request = await fetchLedgerStatementRequest({ config, requestId });
  if (request.transaction_type !== "group_summary" || !request.lookup)
    throw new Error("Invalid group summary job.");
  if (!ledgerSync)
    throw new Error("Local ledger database is unavailable. Update and restart the Connector.");
  return ledgerSync.groupSummary(config, {
    ...request.lookup,
    ...(await companyAccess.resolve(request.lookup)),
  });
}

export async function fetchOutstanding({ config, requestId, ledgerSync, companyAccess }) {
  const request = await fetchLedgerStatementRequest({ config, requestId });
  if (request.transaction_type !== "outstanding" || !request.lookup)
    throw new Error("Invalid outstanding job.");
  if (!ledgerSync)
    throw new Error("Local ledger database is unavailable. Update and restart the Connector.");
  return ledgerSync.outstanding(config, {
    ...request.lookup,
    ...(await companyAccess.resolve(request.lookup)),
  });
}
