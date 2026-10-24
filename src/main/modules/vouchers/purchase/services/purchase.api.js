import { makeRequest } from "../../../../api/httpClient.js";

export function fetchPurchaseVoucherRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/purchases/${encodeURIComponent(requestId)}/connector`, {
    ...options,
    config,
    method: "GET",
    unwrapData: true,
  });
}
