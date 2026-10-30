import { createReadStream, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseEnv } from "node:util";

const releaseVersionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const architectures = new Set(["x64", "ia32", "arm64"]);
const defaultTimeoutMs = 10 * 60 * 1000;
const responseLimitBytes = 64 * 1024;

function validateConfig(config) {
  let serverUrl;
  try { serverUrl = new URL(config.serverUrl); }
  catch { throw new Error("CONNECTOR_RELEASE_SERVER_URL must be a complete server URL."); }
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash) {
    throw new Error("CONNECTOR_RELEASE_SERVER_URL must not contain credentials, a query, or a fragment.");
  }
  if (serverUrl.pathname !== "/") {
    throw new Error("CONNECTOR_RELEASE_SERVER_URL must be the server origin, for example https://sync.flowups.in, without a path prefix.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(serverUrl.hostname);
  if (serverUrl.protocol !== "https:" && !(serverUrl.protocol === "http:" && loopback)) {
    throw new Error("Release uploads require HTTPS. HTTP is supported only for local loopback testing.");
  }
  if (typeof config.token !== "string" || !/^[\x21-\x7e]{32,512}$/.test(config.token)) {
    throw new Error("CONNECTOR_RELEASE_TOKEN must contain 32 to 512 visible ASCII characters without spaces.");
  }
  const timeoutMs = config.timeoutMs === undefined ? defaultTimeoutMs : Number(config.timeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60 * 60 * 1000) {
    throw new Error("CONNECTOR_RELEASE_TIMEOUT_MS must be an integer from 1 to 3600000.");
  }
  return { serverUrl: serverUrl.href.replace(/\/+$/, ""), token: config.token, timeoutMs };
}

/** Read publishing settings without adding them to the packaged application's environment. */
export function loadReleaseConfig({ projectRoot, env = process.env }) {
  const envFile = path.join(projectRoot, ".env.release");
  let fileValues = {};
  try { fileValues = parseEnv(readFileSync(envFile, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new Error("Could not read Connector/.env.release."); }
  const setting = (name) => env[name] ?? fileValues[name] ?? "";
  const serverUrl = String(setting("CONNECTOR_RELEASE_SERVER_URL")).trim();
  if (!serverUrl) return null;
  return validateConfig({
    serverUrl,
    token: setting("CONNECTOR_RELEASE_TOKEN"),
    timeoutMs: setting("CONNECTOR_RELEASE_TIMEOUT_MS") || defaultTimeoutMs,
  });
}

export function validateReleaseIdentity(version, architecture) {
  if (typeof version !== "string" || !releaseVersionPattern.test(version)) {
    throw new Error("Connector package.json version must use stable X.Y.Z format with at most 9 digits per component, for example 0.0.1.");
  }
  if (!architectures.has(architecture)) throw new Error("Connector release architecture must be x64, ia32, or arm64.");
}

export function currentInstallerPath(projectRoot, packageConfig, architecture) {
  validateReleaseIdentity(packageConfig.version, architecture);
  return path.join(projectRoot, "release", `${packageConfig.build.productName} Setup ${packageConfig.version} ${architecture}.exe`);
}

async function installerDigest(installerPath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(installerPath)) hash.update(chunk);
  return hash.digest("hex");
}

async function responseJson(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > responseLimitBytes) throw new Error("Release server returned an unexpectedly large response.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Release server returned an invalid JSON response."); }
}

/** Upload one completed installer. No installer bytes or publishing credentials enter the Electron bundle. */
export async function uploadRelease({ installerPath, version, architecture, config }) {
  validateReleaseIdentity(version, architecture);
  if (!config) throw new Error("Configure CONNECTOR_RELEASE_SERVER_URL and CONNECTOR_RELEASE_TOKEN before uploading.");
  const settings = validateConfig(config);
  let installer;
  try { installer = statSync(installerPath); }
  catch { throw new Error("The current Connector installer is missing. Run npm run package:win first."); }
  if (!installer.isFile() || installer.size < 2 || path.extname(installerPath).toLowerCase() !== ".exe") {
    throw new Error("Release upload requires a completed, non-empty .exe installer.");
  }
  const sha256 = await installerDigest(installerPath);
  const afterHash = statSync(installerPath);
  if (afterHash.size !== installer.size || afterHash.mtimeMs !== installer.mtimeMs) {
    throw new Error("The installer changed while preparing the release. Retry after the build completes.");
  }
  const body = createReadStream(installerPath);
  const signal = AbortSignal.timeout(settings.timeoutMs);
  let response;
  try {
    response = await fetch(`${settings.serverUrl}/api/v1/connector-releases`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(installer.size),
        "X-Release-Token": settings.token,
        "X-Connector-Version": version,
        "X-Connector-Arch": architecture,
        "X-Installer-SHA256": sha256,
      },
      body,
      duplex: "half",
    });
    if (![200, 201].includes(response.status)) {
      await response.body?.cancel();
      throw new Error(`Release upload failed (HTTP ${response.status}). The local installer is kept; retry with npm run release:upload.`);
    }
    const payload = await responseJson(response);
    const release = payload.release;
    const expectedDownloadPath = `/api/v1/connector-releases/${version}/${architecture}/download`;
    if (payload.success !== true || release?.version !== version || release?.architecture !== architecture
      || release?.size_bytes !== installer.size || release?.sha256 !== sha256 || release?.download_url !== expectedDownloadPath) {
      throw new Error("Release server did not confirm the uploaded installer version, architecture, size, and checksum.");
    }
    return { release, downloadUrl: `${settings.serverUrl}${expectedDownloadPath}` };
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Release upload timed out after ${settings.timeoutMs} ms. The local installer is kept; retry with npm run release:upload.`);
    }
    if (error.message.startsWith("Release ")) throw error;
    throw new Error("Release upload could not reach the configured server. The local installer is kept; retry with npm run release:upload.");
  } finally {
    body.destroy();
  }
}
