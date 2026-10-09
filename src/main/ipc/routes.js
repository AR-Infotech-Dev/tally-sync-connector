import { ipcMain } from "electron";

export function registerIpcRoutes(controller) {
  ipcMain.handle("config:load", () => controller.getConfig());
  ipcMain.handle("connector:status:get", () => controller.getStatus());
  ipcMain.handle("config:save", (_event, config) => controller.saveConfig(config));
  ipcMain.handle("connector:connect", () => controller.connect());
  ipcMain.handle("client:register", (_event, payload) => controller.registerClient(payload));
  ipcMain.handle("tally:test-connection", () => controller.testTallyConnection());
  ipcMain.handle("activity:list", (_event, options) => controller.getActivity(options));
  ipcMain.handle("activity:clear", () => controller.clearActivity());
  ipcMain.handle("sales-order:retry", (_event, requestId) => controller.retrySalesOrder(requestId));
}
