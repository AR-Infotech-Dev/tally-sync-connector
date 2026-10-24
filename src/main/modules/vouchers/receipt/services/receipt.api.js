import { makeRequest } from "../../../../api/httpClient.js";

export function fetchReceiptVoucherRequest({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/receipts/${encodeURIComponent(requestId)}/connector`, {
    ...options,
    config,
    method: "GET",
    unwrapData: true,
  });
}
