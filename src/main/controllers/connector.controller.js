import { DEFAULT_CONFIG } from "../config/defaults.js";
import { createLedgerSync } from "../services/ledgerSync.service.js";
import { CONNECTOR_STATUS, makeStatus } from "../utils/status.js";
import { createConnectorSocket } from "../socket/connectorSocket.js";
import {
  registerClientRequest,
  activateConnectorRequest,
} from "../services/clientRegistration.api.js";
import { createTallyConnectorEngine } from "../utils/tally-connector-engine/client.js";

export function createConnectorController({
  configStore,
  notify,
  notifyActivity,
  logStore,
  applySystemSettings,
  temporaryDirectory,
  ledgerCache,
}) {
  let socket;
  const ledgerSync = createLedgerSync({ cache: ledgerCache, onActivity: notifyActivity });
  let currentStatus = makeStatus(
    CONNECTOR_STATUS.disconnected,
    "Configure the Server and Tally connections.",
  );
  const report = (state, message, details) => {
    currentStatus = makeStatus(state, message, details);
    notify(currentStatus);
  };

  function getConfig() {
    return { ...DEFAULT_CONFIG, ...configStore.load() };
  }

  function getStatus() {
    return currentStatus;
  }
  function getLedgerSyncStatus() {
    return ledgerSync.getStatus(getConfig());
  }

  function saveConfig(config) {
    const previous = getConfig();
    const saved = configStore.save(config);
    if (
      previous.clientId !== saved.clientId ||
      previous.connectorKey !== saved.connectorKey ||
      previous.serverUrl !== saved.serverUrl
    )
      disconnect();
    applySystemSettings?.(saved);
    return saved;
  }

  async function testTallyConnection() {
    const config = getConfig();
    const engine = createTallyConnectorEngine();
    const result = await engine.testConnection({
      url: config.tallyUrl,
      timeoutMs: config.requestTimeoutSeconds * 1000,
    });
    return { ...result, configuredCompany: config.tallyCompany };
  }

  function getActivity(options) {
    return logStore?.list(options) || [];
  }
  async function activateConnector({ serverUrl, activationCode }) {
    const code = String(activationCode || "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(code))
      throw new Error("Paste the complete activation code from your registration email.");
    const result = await activateConnectorRequest(String(serverUrl || "").trim(), code);
    if (!result.client_id || !result.connector_id || !result.connector_key)
      throw new Error(
        "Server returned incomplete activation details. Use manual setup from your email.",
      );
    disconnect();
    return saveConfig({
      ...getConfig(),
      serverUrl,
      clientId: result.client_id,
      connectorId: result.connector_id,
      connectorKey: result.connector_key,
      tallyCompany: "",
      onboardingPending: true,
    });
  }
  function clearActivity() {
    return logStore?.clear() || true;
  }
  function retrySalesOrder(requestId) {
    if (!socket?.retrySalesOrder)
      return { success: false, message: "Connect to the Server before retrying this request." };
    return socket.retrySalesOrder(requestId);
  }

  async function registerClient({ serverUrl, name, companyName, email, tallyLicenseNo }) {
    let baseUrl = String(serverUrl || "")
      .trim()
      .replace(/\/+$/, "");
    let parsedUrl;
    try {
      parsedUrl = new URL(baseUrl);
    } catch {
      throw new Error("Enter a valid HTTP or HTTPS server URL.");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Enter a valid HTTP or HTTPS server URL.");
    }
    if (parsedUrl.hostname === "localhost") parsedUrl.hostname = "127.0.0.1";
    baseUrl = parsedUrl.toString().replace(/\/+$/, "");
    let data;
    try {
      data = await registerClientRequest(baseUrl, { name, companyName, email, tallyLicenseNo });
    } catch (cause) {
      throw new Error(`${cause.message} Check that the Server is running and the URL is correct.`);
    }
    return {
      clientId: data.client_id,
      connectorId: data.connector_id,
      email: data.email,
      serverUrl: baseUrl,
    };
  }

  function connect() {
    const config = getConfig();
    if (!config.serverUrl || !config.clientId || !config.connectorId || !config.connectorKey) {
      report(
        CONNECTOR_STATUS.disconnected,
        "Enter the Server URL, Client ID, Connector ID, and Connector Key.",
      );
      return { success: false, message: "Configuration is incomplete." };
    }
    socket?.disconnect();
    report(CONNECTOR_STATUS.connecting, "Opening socket connection to the Server…", {
      registrationState: "pending",
    });
    ledgerSync.start(config);
    socket = createConnectorSocket({
      config,
      notify: report,
      onActivity: notifyActivity,
      temporaryDirectory,
      ledgerSync,
    });
    return { success: true };
  }

  function disconnect() {
    ledgerSync.stop();
    socket?.disconnect();
    socket = undefined;
  }

  return {
    getConfig,
    getStatus,
    getLedgerSyncStatus,
    saveConfig,
    registerClient,
    activateConnector,
    connect,
    disconnect,
    testTallyConnection,
    getActivity,
    clearActivity,
    retrySalesOrder,
  };
}
