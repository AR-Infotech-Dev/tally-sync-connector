export const CONNECTOR_EVENTS = Object.freeze({
  register: "connector:register",
  registered: "connector:registered",
  heartbeat: "connector:heartbeat",
  heartbeatAck: "connector:heartbeat:ack",
  test: "connector:test",
  salesOrderPush: "sales-order:push",
  salesOrderUpdate: "sales-order:update",
  ack: "connector:ack",
});
