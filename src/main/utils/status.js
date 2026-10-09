export const CONNECTOR_STATUS = Object.freeze({
  disconnected: "disconnected",
  connecting: "connecting",
  connected: "connected",
  registered: "registered",
  error: "error",
});

export const makeStatus = (state, message, details = {}) => ({
  state,
  message,
  socketConnected: false,
  registrationState: "not_registered",
  socketId: null,
  registeredAt: null,
  lastHeartbeatAt: null,
  ...details,
});
