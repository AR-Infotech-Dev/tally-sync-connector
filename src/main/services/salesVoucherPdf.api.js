function connectorHeaders(config) {
  return { "X-Client-ID": config.clientId, "X-Connector-Key": config.connectorKey };
}

/** Updates the PDF job state so CRM polling can distinguish work from failure. */
export async function updateSalesVoucherPdfStatus({ config, requestId, status, error }) {
  const response = await fetch(`${config.serverUrl}/api/v1/sales/${encodeURIComponent(requestId)}/pdf/connector/status`, {
    method: "POST",
    headers: { ...connectorHeaders(config), "Content-Type": "application/json" },
    body: JSON.stringify({ status, ...(error ? { error } : {}) }),
    signal: AbortSignal.timeout((Number(config.requestTimeoutSeconds) || 30) * 1000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.message || `Server returned HTTP ${response.status} while updating PDF status.`);
  return result.data || result;
}

/** Uploads the actual Tally-generated PDF to the matching CRM request. */
export async function uploadSalesVoucherPdf({ config, requestId, pdf, filename }) {
  const response = await fetch(`${config.serverUrl}/api/v1/sales/${encodeURIComponent(requestId)}/pdf/connector`, {
    method: "POST",
    headers: {
      ...connectorHeaders(config),
      "Content-Type": "application/pdf",
      "X-PDF-Filename": filename,
    },
    body: pdf,
    signal: AbortSignal.timeout((Number(config.requestTimeoutSeconds) || 30) * 1000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.message || `Server returned HTTP ${response.status} while uploading the PDF.`);
  return result.data || result;
}
