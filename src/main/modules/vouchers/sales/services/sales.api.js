import { makeRequest } from "../../../../api/httpClient.js";

export function fetchSalesVoucherRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/sales/${encodeURIComponent(requestId)}/connector`, {
    ...options,
    config,
    method: "GET",
    unwrapData: true,
  });
}
