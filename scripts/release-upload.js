import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { currentInstallerPath, loadReleaseConfig, uploadRelease } from "./release-publisher.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const architecture = args.includes("--ia32") ? "ia32" : args.includes("--arm64") ? "arm64" : "x64";

try {
  const config = loadReleaseConfig({ projectRoot });
  if (!config)
    throw new Error(
      "Set CONNECTOR_RELEASE_SERVER_URL and CONNECTOR_RELEASE_TOKEN in Connector/.env.release first.",
    );
  const packageConfig = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const result = await uploadRelease({
    installerPath: currentInstallerPath(projectRoot, packageConfig, architecture),
    version: packageConfig.version,
    architecture,
    config,
  });
  console.info(`Published Connector ${result.release.version} (${result.release.architecture}).`);
  console.info(`Download: ${result.downloadUrl}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
