import http from "node:http";
import https from "node:https";

/**
 * Resolves the Tally endpoint from an explicit URL or host/port settings.
 * Defaults to the common local TallyPrime listener at 127.0.0.1:9000.
 *
 * @param {{url?: string, protocol?: string, host?: string, port?: number}} tally Tally connection settings.
 * @returns {URL} Validated HTTP(S) endpoint.
 * @throws {Error} If the endpoint is malformed or uses another protocol.
 */
function resolveEndpoint(tally = {}) {
  const endpoint =
    tally.url ||
    `${tally.protocol || "http:"}//${tally.host || "127.0.0.1"}:${Number(tally.port || 9000)}`;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Tally URL must be a valid HTTP or HTTPS URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Tally URL must use HTTP or HTTPS.");
  }
  return url;
}

/**
 * Creates an HTTP transport that posts XML to TallyPrime.
 *
 * The response size is capped to avoid unbounded memory use. Each request can
 * override the timeout and add headers; Tally credentials/auth are not assumed.
 *
 * @param {{defaultTimeoutMs?: number, maxResponseBytes?: number}} options Transport defaults.
 * @returns {{postXml: Function}} Transport API consumed by the engine.
 */
export function createTallyHttpTransport({
  defaultTimeoutMs = 30000,
  maxResponseBytes = 5 * 1024 * 1024,
} = {}) {
  /**
   * Sends one XML document and returns the HTTP status, headers, and response body.
   *
   * @param {object} tally Endpoint settings. `timeoutMs` may override the default.
   * @param {string} xml Full XML request body.
   * @param {{timeoutMs?: number, headers?: Record<string, string>, responseType?: "text"|"buffer"}} [options] Per-request overrides.
   * @returns {Promise<{endpoint: string, status: number, headers: object, body: string|Buffer}>} Tally HTTP response.
   */
  async function postXml(tally, xml, options = {}) {
    options.signal?.throwIfAborted();
    if (typeof xml !== "string" || !xml.trim())
      throw new Error("Tally XML request cannot be empty.");
    const url = resolveEndpoint(tally);
    const timeoutMs = Number(options.timeoutMs || tally.timeoutMs || defaultTimeoutMs);
    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (cause) => {
        if (settled) return;
        settled = true;
        const code = cause.code ? ` (${cause.code})` : "";
        const unavailable = ["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "ENETUNREACH"].includes(
          cause.code,
        );
        reject(
          Object.assign(
            new Error(
              `Could not send the request to Tally at ${url.origin}${code}: ${cause.message}`,
              { cause },
            ),
            {
              ...(unavailable ? { code: "TALLY_NOT_CONNECTED", httpStatus: 503 } : {}),
              ...(cause.code === "TALLY_TIMEOUT" ? { code: "TALLY_TIMEOUT", httpStatus: 504 } : {}),
              ...(cause.code === "TALLY_RESPONSE_TOO_LARGE"
                ? { code: cause.code, httpStatus: 502, maxResponseBytes: cause.maxResponseBytes }
                : {}),
            },
          ),
        );
      };
      const request = transport.request(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            Accept: "application/xml, text/xml, */*",
            "Content-Length": Buffer.byteLength(xml),
            ...(options.headers || {}),
          },
          timeout: timeoutMs,
        },
        (response) => {
          const chunks = [];
          let responseBytes = 0;
          response.on("error", fail);
          response.on("aborted", () =>
            fail(new Error("Tally response was interrupted before completion.")),
          );
          response.on("data", (chunk) => {
            if (settled) return;
            responseBytes += chunk.length;
            if (responseBytes > maxResponseBytes) {
              chunks.length = 0;
              fail(
                Object.assign(new Error(`Tally response exceeded ${maxResponseBytes} bytes.`), {
                  code: "TALLY_RESPONSE_TOO_LARGE",
                  maxResponseBytes,
                }),
              );
              response.destroy();
              request.destroy();
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            if (settled) return;
            settled = true;
            resolve({
              endpoint: url.toString(),
              status: response.statusCode || 0,
              headers: response.headers,
              body:
                options.responseType === "buffer"
                  ? Buffer.concat(chunks)
                  : Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      request.on("timeout", () => {
        fail(
          Object.assign(new Error(`Tally request timed out after ${timeoutMs}ms.`), {
            code: "TALLY_TIMEOUT",
          }),
        );
        request.destroy();
      });
      const abort = () => {
        fail(new Error("Tally request cancelled."));
        request.destroy();
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      request.on("close", () => options.signal?.removeEventListener("abort", abort));
      request.on("error", fail);
      request.end(xml);
    });
  }

  return Object.freeze({ postXml });
}
