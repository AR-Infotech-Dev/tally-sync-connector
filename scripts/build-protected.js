import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build as esbuild } from "esbuild";
import JavaScriptObfuscator from "javascript-obfuscator";

const projectRoot = path.resolve(".");
const args = process.argv.slice(2);
const architecture = args.includes("--ia32") ? "ia32" : "x64";
const buildRoot = path.join(projectRoot, "build");
const stageDir = path.join(buildRoot, `protected-app-${architecture}-${Date.now()}`);
const packageConfig = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

// Match the protection settings used by Soul Tally Connect for Electron code.
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.35,
  identifierNamesGenerator: "hexadecimal",
  stringArray: true,
  stringArrayEncoding: ["rc4"],
  rotateStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 8,
  selfDefending: true,
  disableConsoleOutput: true,
};

assertInside(projectRoot, stageDir);
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(stageDir, "src/main"), { recursive: true });
fs.mkdirSync(path.join(stageDir, "src/preload"), { recursive: true });

await bundleAndObfuscateMain();
await bundleAndObfuscatePreload();
copyProtectedRenderer();
writePackagedManifest();
validateStage();
runElectronBuilder();
publishSetup();

async function bundleAndObfuscateMain() {
  const outputFile = path.join(stageDir, "src/main/index.cjs");
  const temporaryFile = `${outputFile}.raw`;
  await esbuild({
    entryPoints: [path.join(projectRoot, "src/main/index.js")],
    outfile: temporaryFile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    sourcemap: false,
    minify: true,
    logLevel: "silent",
  });
  obfuscateFile(temporaryFile, outputFile, "node");
  fs.rmSync(temporaryFile);
}

async function bundleAndObfuscatePreload() {
  const outputFile = path.join(stageDir, "src/preload/index.cjs");
  const temporaryFile = `${outputFile}.raw`;
  await esbuild({
    entryPoints: [path.join(projectRoot, "src/preload/index.cjs")],
    outfile: temporaryFile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    sourcemap: false,
    minify: true,
    logLevel: "silent",
  });
  obfuscateFile(temporaryFile, outputFile, "node");
  fs.rmSync(temporaryFile);
}

function copyProtectedRenderer() {
  const sourceDir = path.join(projectRoot, "dist/renderer");
  if (!fs.existsSync(path.join(sourceDir, "index.html"))) {
    throw new Error("Renderer build is missing. Run `npm run build` first.");
  }

  const targetDir = path.join(stageDir, "dist/renderer");
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  for (const file of listFiles(targetDir).filter((item) => item.endsWith(".js"))) {
    obfuscateFile(file, file, "browser");
  }
}

function writePackagedManifest() {
  const installedElectron = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "node_modules/electron/package.json"),
    "utf8",
  )).version;
  const manifest = {
    name: packageConfig.name,
    version: packageConfig.version,
    description: packageConfig.description,
    author: packageConfig.author,
    private: true,
    main: "src/main/index.cjs",
    // electron-builder requires a pinned Electron version in the staged app.
    devDependencies: { electron: installedElectron },
    build: {
      ...packageConfig.build,
      files: ["src/main/index.cjs", "src/preload/index.cjs", "dist/renderer/**/*", "package.json"],
      asar: true,
    },
  };
  fs.writeFileSync(path.join(stageDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function obfuscateFile(sourceFile, outputFile, target) {
  const options = {
    ...obfuscationOptions,
    target,
    sourceMap: false,
  };
  const result = JavaScriptObfuscator.obfuscate(fs.readFileSync(sourceFile, "utf8"), options);
  fs.writeFileSync(outputFile, `${result.getObfuscatedCode()}\n`);
}

function validateStage() {
  const mainFile = path.join(stageDir, "src/main/index.cjs");
  const preloadFile = path.join(stageDir, "src/preload/index.cjs");
  for (const file of [mainFile, preloadFile]) {
    const check = spawnSync(process.execPath, ["--check", file], { stdio: "inherit", shell: false });
    if (check.status !== 0) throw new Error(`Protected bundle syntax check failed: ${path.relative(stageDir, file)}`);
  }

  const allFiles = listFiles(stageDir).map((file) => path.relative(stageDir, file).replace(/\\/g, "/"));
  if (allFiles.some((file) => file.endsWith(".map") || file.endsWith(".raw"))) {
    throw new Error("Protected staging output must not contain source maps or raw bundles.");
  }
}

function runElectronBuilder() {
  const builderCli = path.join(projectRoot, "node_modules/electron-builder/cli.js");
  if (!fs.existsSync(builderCli)) throw new Error("electron-builder is missing. Install project dependencies first.");
  const result = spawnSync(process.execPath, [builderCli, "--projectDir", stageDir, "--win", "nsis", `--${architecture}`], {
    cwd: projectRoot,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) throw new Error("electron-builder failed for the protected Connector build.");
}

function publishSetup() {
  const stagedInstaller = path.join(
    stageDir,
    packageConfig.build.directories.output,
    `${packageConfig.build.productName} Setup ${packageConfig.version} ${architecture}.exe`,
  );
  const releaseDir = path.join(projectRoot, "release");
  const finalInstaller = path.join(releaseDir, path.basename(stagedInstaller));
  if (!fs.existsSync(stagedInstaller)) throw new Error("Protected setup executable was not created.");
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.copyFileSync(stagedInstaller, finalInstaller);
  console.log(`Protected setup executable: ${path.relative(projectRoot, finalInstaller)}`);
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to create protected build outside project: ${child}`);
  }
}
