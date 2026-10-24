import { makeRequest } from "../../../../api/httpClient.js";

export function fetchPurchaseOrderRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/purchase-orders/${encodeURIComponent(requestId)}/connector`, {
    ...options,
    config,
    method: "GET",
    unwrapData: true,
  });
}
