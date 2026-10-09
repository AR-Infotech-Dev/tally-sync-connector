export function getRegistrationState(status = {}) {
  if (status.registrationState) return status.registrationState;
  if (status.state === "registered") return "registered";
  if (status.state === "error" && status.socketConnected) return "failed";
  return status.state === "connecting" ? "pending" : "not_registered";
}

export function getRegistrationLabel(status = {}) {
  const state = getRegistrationState(status);
  if (state === "registered") return "Registered";
  if (state === "pending") return "Waiting for registration";
  if (state === "failed") return "Registration failed";
  return "Not registered";
}

export function getSocketLabel(status = {}) {
  if (status.socketConnected) return "Connected";
  if (status.state === "connecting") return "Connecting";
  return "Disconnected";
}

export function getConnectionPill(status = {}) {
  const registrationState = getRegistrationState(status);
  if (registrationState === "registered") return { label: "REGISTERED", tone: "registered" };
  if (registrationState === "failed") return { label: "REGISTRATION FAILED", tone: "error" };
  if (registrationState === "pending" && status.socketConnected) return { label: "SOCKET CONNECTED · REGISTERING", tone: "connecting" };
  if (status.state === "connecting") return { label: "CONNECTING TO SOCKET", tone: "connecting" };
  return { label: "SOCKET OFFLINE", tone: "disconnected" };
}
