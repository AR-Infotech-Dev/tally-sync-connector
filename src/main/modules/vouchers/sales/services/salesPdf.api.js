import { makeRequest } from "../../../../api/httpClient.js";

export function fetchSalesPdfJob({ config, requestId, ...options }) {
  return makeRequest(`/api/v1/sales/${encodeURIComponent(requestId)}/pdf/connector`, { ...options, config: config, unwrapData: true });
}

export function updateSalesVoucherPdfStatus({ config, requestId, status, error, errorCode, ...options }) {
  return makeRequest(`/api/v1/sales/${encodeURIComponent(requestId)}/pdf/connector/status`, { ...options, config: config, method: "POST", body: { status, ...(error ? { error } : {}), ...(errorCode ? { error_code: errorCode } : {}) }, unwrapData: true });
}

export function uploadSalesVoucherPdf({ config, requestId, pdf, filename, ...options }) {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("X-PDF-Filename", filename);
  return makeRequest(`/api/v1/sales/${encodeURIComponent(requestId)}/pdf/connector`, { ...options, config: config, method: "POST", headers: headers, body: pdf, unwrapData: true });
}
