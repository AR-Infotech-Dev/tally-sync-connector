import { app, BrowserWindow, Menu, nativeImage, safeStorage, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpcRoutes } from "./ipc/routes.js";
import { createConnectorController } from "./controllers/connector.controller.js";
import { createConfigStore } from "./utils/configStore.js";
import { createActivityLogStore } from "./utils/activityLogStore.js";

// Keep development paths relative to this source file. In the packaged app,
// use Electron's app root so bundled main code still finds preload and renderer.
const here = app.isPackaged
  ? path.join(app.getAppPath(), "src/main")
  : path.dirname(fileURLToPath(import.meta.url));
let mainWindow;
let connectorController;
let connectorTray;
let isQuitting = false;
let configStore;

function openWindow() {
  if (!mainWindow) return createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createSystemTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="8" fill="#2862d7"/><path d="M8 12h12l-3-3m3 3-3 3M24 20H12l3 3m-3-3 3-3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  connectorTray = new Tray(icon);
  connectorTray.setToolTip("Tally Sync Connector is running");
  connectorTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Connector", click: openWindow },
    { type: "separator" },
    { label: "Quit Connector", click: () => { isQuitting = true; connectorController?.disconnect(); app.quit(); } },
  ]));
  connectorTray.on("double-click", openWindow);
}

function applySystemSettings(config) {
  app.setLoginItemSettings({ openAtLogin: Boolean(config.startWithWindows), args: ["--background"] });
  connectorTray?.setToolTip(config.minimizeToTray ? "Tally Sync Connector is running in the background" : "Tally Sync Connector");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    webPreferences: {
      preload: path.join(here, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null)
  if (app.isPackaged) mainWindow.loadFile(path.join(here, "../../dist/renderer/index.html"));
  else mainWindow.loadURL("http://localhost:5173");
  mainWindow.once("ready-to-show", () => { if (!process.argv.includes("--background")) mainWindow?.show(); });
  mainWindow.on("close", (event) => {
    if (!isQuitting && configStore?.load().minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.whenReady().then(() => {
  const userDataPath = app.getPath("userData");
  configStore = createConfigStore(userDataPath, safeStorage);
  const logStore = createActivityLogStore(userDataPath);
  createSystemTray();
  connectorController = createConnectorController({
    configStore,
    notify: (status) => mainWindow?.webContents.send("connector:status", status),
    notifyActivity: (item) => {
      logStore.append(item, configStore.load().logRetentionDays);
      mainWindow?.webContents.send("connector:activity", item);
    },
    logStore,
    temporaryDirectory: app.getPath("temp"),
    applySystemSettings,
  });
  applySystemSettings(configStore.load());
  registerIpcRoutes(connectorController);
  createWindow();
  if (configStore.load().clientId && configStore.load().connectorKey) connectorController.connect();
  app.on("activate", openWindow);
});

app.on("window-all-closed", () => {
  if (isQuitting || !configStore?.load().minimizeToTray) {
    connectorController?.disconnect();
    if (process.platform !== "darwin") app.quit();
  }
});

app.on("before-quit", () => { isQuitting = true; connectorController?.disconnect(); });
