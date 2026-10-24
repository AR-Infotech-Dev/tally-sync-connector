import http from "node:http";
import https from "node:https";

export function registerClientRequest(serverUrl, input) {
  return clientRequest(serverUrl, '/api/v1/clients/register', {
    name: input.name,
    company_name: input.companyName,
    email: input.email,
    tally_license_no: input.tallyLicenseNo,
  });
}

export function activateConnectorRequest(serverUrl, code) {
  return clientRequest(serverUrl, '/api/v1/clients/activate-connector', { activation_code: code });
}

function clientRequest(serverUrl, path, payload) {
  const url = new URL(path, serverUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a valid HTTP or HTTPS Server URL without embedded credentials.');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for a remote Server. HTTP is allowed only on this computer.');
  const body = JSON.stringify(payload);
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
      response.on("data", (chunk) => {
        responseBody += chunk;
        if (responseBody.length > 65536) request.destroy(new Error('Server returned an oversized setup response.'));
      });
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
