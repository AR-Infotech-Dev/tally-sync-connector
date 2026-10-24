export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_HEADERS = Object.freeze({ Accept: "application/json" });

export function getDefaultHeaders(config = {}, authenticated = true) {
  return {
    ...DEFAULT_HEADERS,
    ...(authenticated && config.clientId ? { "X-Client-ID": config.clientId } : {}),
    ...(authenticated && config.connectorKey ? { "X-Connector-Key": config.connectorKey } : {}),
  };
}
