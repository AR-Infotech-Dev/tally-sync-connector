import { makeRequest } from "../../../api/httpClient.js";

export function fetchLedgerStatementRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/sales-orders/${encodeURIComponent(requestId)}/connector`, { ...options, config: config, method: "GET", unwrapData: true });
}
