import { createTallyConnectorEngine } from "../utils/tally-connector-engine/client.js";
import { CONNECTOR_EVENTS } from "../socket/events.js";

/** Answers the Server's read-only probe; it never imports vouchers. */
export function registerTallyAvailabilityCheck(socket, config) {
  socket.on(CONNECTOR_EVENTS.tallyCheck, async (payload = {}, acknowledge) => {
    if (typeof acknowledge !== "function") return;
    if (payload.require_tally === false) {
      acknowledge({ success: true });
      return;
    }
    const requested = Number(payload.timeout_ms) || 5000;
    const timeoutMs = Math.min(10000, Math.max(1000, requested));
    try {
      const result = await createTallyConnectorEngine().testConnection({
        url: config.tallyUrl,
        timeoutMs,
      });
      acknowledge(
        result.ok ? { success: true } : { success: false, error_code: "TALLY_NOT_CONNECTED" },
      );
    } catch (error) {
      acknowledge({
        success: false,
        error_code: error.code === "TALLY_TIMEOUT" ? "TALLY_TIMEOUT" : "TALLY_NOT_CONNECTED",
      });
    }
  });
}
