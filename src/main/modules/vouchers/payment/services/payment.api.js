import { makeRequest } from "../../../../api/httpClient.js";

export function fetchPaymentVoucherRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/payments/${encodeURIComponent(requestId)}/connector`, {
    ...options,
    config,
    method: "GET",
    unwrapData: true,
  });
}
