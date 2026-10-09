const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("connector", {
  loadConfig: () => ipcRenderer.invoke("config:load"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  connect: () => ipcRenderer.invoke("connector:connect"),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("connector:status", listener);
    return () => ipcRenderer.removeListener("connector:status", listener);
  },
});
