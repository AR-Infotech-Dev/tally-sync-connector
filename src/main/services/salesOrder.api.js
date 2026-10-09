export async function fetchSalesOrderRequest({ config, requestId }) {
  const response = await fetch(`${config.serverUrl}/api/v1/sales-orders/${encodeURIComponent(requestId)}/connector`, {
    headers: { "X-Client-ID": config.clientId, "X-Connector-Key": config.connectorKey },
    signal: AbortSignal.timeout((Number(config.requestTimeoutSeconds) || 30) * 1000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new Error(result.message || `Server returned HTTP ${response.status}.`);
  return result.data || result;
}
