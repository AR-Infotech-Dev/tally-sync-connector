const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("connector", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  getStatus: () => ipcRenderer.invoke("connector:status:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  connect: () => ipcRenderer.invoke("connector:connect"),
  registerClient: (payload) => ipcRenderer.invoke("client:register", payload),
  testTallyConnection: () => ipcRenderer.invoke("tally:test-connection"),
  loadActivity: (options) => ipcRenderer.invoke("activity:list", options),
  clearActivity: () => ipcRenderer.invoke("activity:clear"),
  retrySalesOrder: (requestId) => ipcRenderer.invoke("sales-order:retry", requestId),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("connector:status", listener);
    return () => ipcRenderer.removeListener("connector:status", listener);
  },
  onActivity: (callback) => {
    const listener = (_event, item) => callback(item);
    ipcRenderer.on("connector:activity", listener);
    return () => ipcRenderer.removeListener("connector:activity", listener);
  },
});
