import axios from "axios";
import { DEFAULT_TIMEOUT, getDefaultHeaders } from "./config.js";

/** Server API client. Voucher modules own endpoint paths and payloads. */
export async function makeRequest(url, options = {}) {
  const {
    config = {}, baseURL = config.serverUrl, method = "GET", headers = {},
    body, params, timeout = (Number(config.requestTimeoutSeconds) * 1000) || DEFAULT_TIMEOUT,
    responseType = "json", unwrapData = false, authenticated = true, signal,
    maxResponseBytes = 5 * 1024 * 1024, requireSecureRemote = false,
    ...extraOptions
  } = options;
  const base = new URL(baseURL);
  const endpoint = new URL(url, base);
  if (!["http:", "https:"].includes(endpoint.protocol) || base.username || base.password || endpoint.username || endpoint.password || endpoint.origin !== base.origin) {
    throw new Error("Enter a valid HTTP or HTTPS Server URL without embedded credentials.");
  }
  if (requireSecureRemote && endpoint.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("Use HTTPS for a remote Server. HTTP is allowed only on this computer.");
  }
  if (!url || !["json", "text", "buffer", "arraybuffer", "blob"].includes(responseType)) throw new TypeError("A Server API URL and valid responseType are required.");
  const requestHeaders = new Headers(getDefaultHeaders(config, authenticated));
  new Headers(headers).forEach((value, key) => requestHeaders.set(key, value));
  if (typeof FormData !== "undefined" && body instanceof FormData) requestHeaders.delete("Content-Type");
  if (params) for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    for (const item of Array.isArray(value) ? value : [value]) endpoint.searchParams.append(key, String(item));
  }
  const timeoutSignal = AbortSignal.timeout(timeout);
  const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  let response;
  try {
    response = await axios({
      ...extraOptions, url: endpoint.href, method, headers: Object.fromEntries(requestHeaders),
      data: body, signal: requestSignal, timeout, responseType: "arraybuffer",
      maxContentLength: maxResponseBytes, maxBodyLength: extraOptions.maxBodyLength ?? Infinity,
      maxRedirects: 0, validateStatus: () => true,
    });
  } catch (cause) {
    const message = timeoutSignal.aborted || cause.code === "ECONNABORTED" ? `Server request timed out after ${timeout}ms.`
      : signal?.aborted ? "Server request cancelled."
        : /maxContentLength/.test(cause.message) ? "Server returned an oversized response."
          : `Cannot connect to ${endpoint.origin}: ${cause.message}`;
    throw Object.assign(new Error(message, { cause }), {
      code: timeoutSignal.aborted || cause.code === "ECONNABORTED" ? "SERVER_TIMEOUT" : signal?.aborted ? "SERVER_CANCELLED" : "SERVER_REQUEST_FAILED",
    });
  }
  const bytes = Buffer.from(response.data);
  const ok = response.status >= 200 && response.status < 300;
  let payload;
  try { payload = bytes.length ? JSON.parse(bytes.toString("utf8")) : null; } catch {
    if (ok && responseType === "json") throw Object.assign(new Error("Server returned invalid JSON."), { httpStatus: 502, status: 502, code: "INVALID_SERVER_RESPONSE" });
  }
  if (!ok || payload?.success === false || payload?.flag === "F") {
    throw Object.assign(new Error(payload?.message || payload?.msg || `Server returned HTTP ${response.status}.`), {
      httpStatus: response.status, status: response.status, code: payload?.code, type: payload?.type, details: payload,
    });
  }
  if (responseType !== "json") {
    const data = responseType === "text" ? bytes.toString("utf8")
      : responseType === "blob" ? new Blob([bytes], { type: response.headers["content-type"] }) : bytes;
    return unwrapData ? data : { success: true, status: response.status, data, headers: response.headers };
  }
  if (unwrapData) return payload?.data ?? payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? { ...payload, status: response.status } : { status: response.status, data: payload };
}
