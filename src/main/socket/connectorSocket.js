import { io } from "socket.io-client";
import { CONNECTOR_EVENTS as EVENTS } from "./events.js";
import { fetchSalesOrderRequest } from "../services/salesOrder.api.js";
import { buildSalesOrderXml } from "../utils/tally-connector-engine/xml.js";
import { createTallyConnectorEngine } from "../utils/tally-connector-engine/index.js";

export function createConnectorSocket({ config, notify, onActivity }) {
  let heartbeatTimer;
  let registeredAt = null;
  const activeSalesOrders = new Set();
  const socket = io(config.serverUrl, { transports: ["websocket"], reconnection: true, reconnectionAttempts: Infinity });

  socket.on("connect", () => {
    registeredAt = null;
    notify("connecting", "Socket connected. Waiting for Connector registration…", {
      socketConnected: true,
      registrationState: "pending",
      socketId: socket.id,
    });
    socket.emit(EVENTS.register, {
      client_id: config.clientId,
      connector_id: config.connectorId,
      connector_key: config.connectorKey,
    }, (result) => {
      if (!result?.success) {
        registeredAt = null;
        notify("error", result?.message || "Connector registration failed.", {
          socketConnected: socket.connected,
          registrationState: "failed",
          socketId: socket.id,
        });
        return;
      }
      registeredAt = result.registered_at || new Date().toISOString();
      notify("registered", "Socket connected and Connector registered with the Server.", {
        socketConnected: true,
        registrationState: "registered",
        socketId: result.socket_id || socket.id,
        registeredAt,
      });
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        socket.emit(EVENTS.heartbeat, { at: new Date().toISOString() }, (heartbeat) => {
          if (!heartbeat?.success) notify("error", "Server rejected the heartbeat. Connector registration needs attention.", {
            socketConnected: socket.connected,
            registrationState: "failed",
            socketId: socket.id,
            registeredAt: null,
          });
        });
      }, 25_000);
    });
  });
  socket.on("connect_error", (error) => {
    clearInterval(heartbeatTimer);
    registeredAt = null;
    notify("disconnected", `Socket connection failed: ${error.message}`, {
      socketConnected: false,
      registrationState: "not_registered",
      socketId: null,
    });
  });
  socket.on("disconnect", () => {
    clearInterval(heartbeatTimer);
    registeredAt = null;
    notify("disconnected", "Socket disconnected from the Server.", {
      socketConnected: false,
      registrationState: "not_registered",
      socketId: null,
      registeredAt: null,
    });
  });
  socket.on(EVENTS.registered, (result = {}) => notify("registered", "Connector registration confirmed by the Server.", {
    socketConnected: socket.connected,
    registrationState: "registered",
    socketId: result.socket_id || socket.id,
    registeredAt: result.registered_at || registeredAt || new Date().toISOString(),
  }));
  socket.on(EVENTS.test, (payload) => {
    notify("registered", payload?.message || "Test signal received.", {
      socketConnected: socket.connected,
      registrationState: "registered",
      socketId: socket.id,
      registeredAt,
    });
    socket.emit(EVENTS.ack, { event: EVENTS.test, received: true, at: new Date().toISOString() });
  });
  socket.on(EVENTS.salesOrderPush, (signal = {}) => {
    if (signal.request_id) void processSalesOrder(signal.request_id);
    socket.emit(EVENTS.ack, {
      event: EVENTS.salesOrderPush,
      request_id: signal.request_id,
      received: Boolean(signal.request_id),
      at: new Date().toISOString(),
    });
  });
  socket.on(EVENTS.heartbeatAck, () => {
    const lastHeartbeatAt = new Date().toISOString();
    notify("registered", "Connector is registered. Server heartbeat acknowledged.", {
      socketConnected: socket.connected,
      registrationState: "registered",
      socketId: socket.id,
      registeredAt,
      lastHeartbeatAt,
    });
  });

  async function processSalesOrder(requestId) {
    if (activeSalesOrders.has(requestId)) return;
    activeSalesOrders.add(requestId);
    const update = (status, message, extra = {}) => {
      onActivity?.({ requestId, status, message, at: new Date().toISOString() });
      socket.emit(EVENTS.salesOrderUpdate, { request_id: requestId, status, ...extra });
    };
    try {
      update("fetching", "Fetching sales order from Server…");
      const request = await fetchSalesOrderRequest({ config, requestId });
      update("building_xml", "Sales order fetched. Building Tally XML…");
      const xml = buildSalesOrderXml({
        companyName: config.tallyCompany || request.destination?.company || request.destination?.company_name,
        order: request.sales_order,
      });
      console.log(`Built Tally XML for sales order ${request.sales_order?.voucher_number || "(no number)"}:\n${xml}`);
      const salesOrder = request.sales_order || {};
      update("pushing", `Sending ${salesOrder.voucher_type || "Sales Order"} voucher ${salesOrder.voucher_number || "(no number)"} dated ${salesOrder.date || "(no date)"} to Tally at ${config.tallyUrl}…`);
      const engine = createTallyConnectorEngine();
      const result = await engine.importXml({ url: config.tallyUrl }, xml, { timeoutMs: (Number(config.requestTimeoutSeconds) || 30) * 1000 });
      if (!result.ok) {
        const errors = result.summary?.lineErrors?.join("; ") || `Tally reported ${result.summary?.errors ?? "an"} error(s).`;
        throw new Error(errors);
      }
      update("succeeded", `Tally accepted the order. Created ${result.summary.created}, altered ${result.summary.altered}.`, { tally_result: result.summary });
    } catch (error) {
      console.log(error);
      
      update("failed", error.message, { error: error.message });
    } finally {
      activeSalesOrders.delete(requestId);
    }
  }

  // Expose a guarded retry entry point for the Logs UI. The same in-memory
  // processing guard prevents a manual retry from duplicating an active job.
  socket.retrySalesOrder = (requestId) => {
    if (typeof requestId !== "string" || !requestId.trim()) {
      return { success: false, message: "A valid request ID is required." };
    }
    if (!socket.connected) {
      return { success: false, message: "Connect to the Server before retrying this request." };
    }
    if (activeSalesOrders.has(requestId)) {
      return { success: false, message: "This sales order is already being processed." };
    }
    void processSalesOrder(requestId);
    return { success: true };
  };

  return socket;
}
