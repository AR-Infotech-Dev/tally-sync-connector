import http from "node:http";
import https from "node:https";

export function registerClientRequest(serverUrl, input) {
  const url = new URL("/api/v1/clients/register", serverUrl);
  const body = JSON.stringify({
    name: input.name,
    company_name: input.companyName,
    email: input.email,
    tally_license_no: input.tallyLicenseNo,
  });
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
      },
      timeout: 15000,
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => {
        let data = {};
        try { data = JSON.parse(responseBody); } catch { /* handled as an API error below */ }
        if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300 || data.success === false) {
          reject(new Error(data.message || data.msg || `Registration API returned HTTP ${response.statusCode || 500}.`));
          return;
        }
        resolve(data);
      });
    });

    request.on("timeout", () => request.destroy(new Error("Request timed out after 15 seconds.")));
    request.on("error", (cause) => {
      const code = cause.code ? ` (${cause.code})` : "";
      reject(new Error(`Cannot connect to ${url.origin}${code}: ${cause.message}`));
    });
    request.end(body);
  });
}
