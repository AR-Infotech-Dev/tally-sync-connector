// React talks to the Electron main-process socket through the restricted preload bridge.
// Socket.IO itself stays out of the renderer process.
export const socketBridge = {
  connect: () => window.connector.connect(),
  onStatus: (listener) => window.connector.onStatus(listener),
  onActivity: (listener) => window.connector.onActivity(listener),
};
