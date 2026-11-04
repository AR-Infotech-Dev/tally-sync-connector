import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG } from "../config/defaults.js";

export function createConfigStore(directory, safeStorage) {
  const filePath = path.join(directory, "connector-config.json");

  function load() {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
    let connectorKey = "";
    try {
      if (stored.connector_key_encrypted && safeStorage.isEncryptionAvailable()) {
        connectorKey = safeStorage.decryptString(
          Buffer.from(stored.connector_key_encrypted, "base64"),
        );
      }
    } catch {
      connectorKey = "";
    }
    return {
      ...DEFAULT_CONFIG,
      serverUrl: stored.serverUrl || DEFAULT_CONFIG.serverUrl,
      clientId: stored.clientId || "",
      connectorId: stored.connectorId || "",
      connectorKey,
      onboardingPending: stored.onboardingPending === true,
      onboardingSyncStarted: stored.onboardingSyncStarted === true,
      autoSync: stored.autoSync === true,
      tallyUrl: stored.tallyUrl || DEFAULT_CONFIG.tallyUrl,
      minimizeToTray: stored.minimizeToTray !== false,
      startWithWindows: stored.startWithWindows === true,
      requestTimeoutSeconds:
        Number(stored.requestTimeoutSeconds) || DEFAULT_CONFIG.requestTimeoutSeconds,
      logRetentionDays: Number(stored.logRetentionDays) || DEFAULT_CONFIG.logRetentionDays,
    };
  }

  function save(input = {}) {
    const config = {
      serverUrl: String(input.serverUrl || "")
        .trim()
        .replace(/\/$/, ""),
      clientId: String(input.clientId || "").trim(),
      connectorId: String(input.connectorId || "").trim(),
      connectorKey: String(input.connectorKey || "").trim(),
      onboardingPending: input.onboardingPending === true,
      onboardingSyncStarted: input.onboardingSyncStarted === true,
      autoSync: input.autoSync === true,
      tallyUrl: String(input.tallyUrl || DEFAULT_CONFIG.tallyUrl).trim(),
      minimizeToTray: input.minimizeToTray !== false,
      startWithWindows: input.startWithWindows === true,
      requestTimeoutSeconds: Math.min(
        120,
        Math.max(5, Number(input.requestTimeoutSeconds) || DEFAULT_CONFIG.requestTimeoutSeconds),
      ),
      logRetentionDays: Math.min(
        365,
        Math.max(1, Number(input.logRetentionDays) || DEFAULT_CONFIG.logRetentionDays),
      ),
    };
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure credential storage is unavailable on this computer.");
    }
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify(
        {
          serverUrl: config.serverUrl,
          clientId: config.clientId,
          connectorId: config.connectorId,
          onboardingPending: config.onboardingPending,
          onboardingSyncStarted: config.onboardingSyncStarted,
          autoSync: config.autoSync,
          tallyUrl: config.tallyUrl,
          minimizeToTray: config.minimizeToTray,
          startWithWindows: config.startWithWindows,
          requestTimeoutSeconds: config.requestTimeoutSeconds,
          logRetentionDays: config.logRetentionDays,
          connector_key_encrypted: safeStorage
            .encryptString(config.connectorKey)
            .toString("base64"),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return config;
  }

  return { load, save };
}
