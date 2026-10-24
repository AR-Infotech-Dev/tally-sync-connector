import { makeRequest } from "../api/httpClient.js";

function setupRequest(serverUrl, path, json) {
  return makeRequest(path, { baseURL: serverUrl, method: "POST", body: json, authenticated: false, unwrapData: false, timeout: 15000, maxResponseBytes: 65536, requireSecureRemote: true });
}

export function registerClientRequest(serverUrl, input) {
  return setupRequest(serverUrl, "/api/v1/clients/register", {
    name: input.name, company_name: input.companyName, email: input.email,
    tally_license_no: input.tallyLicenseNo,
  });
}

export function activateConnectorRequest(serverUrl, code) {
  return setupRequest(serverUrl, "/api/v1/clients/activate-connector", { activation_code: code });
}
