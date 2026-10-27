// Keep voucher rules here. Date and due-date validation remain in shared date helpers.
export function validateSalesOrderItems({ items }) {
  if (!Array.isArray(items) || items.length === 0) throw new TypeError("Sales order must include a non-empty items array.");
}

export function validateSalesOrderParty({ party }) {
  if (!party) throw new TypeError("Sales order requires party.ledger_name, party_ledger_entry.ledger, or party_ledger.");
}

export function validateSalesOrderOrderNumber({ isOrder, orderNo }) {
  if (isOrder && !String(orderNo).trim()) throw new TypeError("Sales Order requires order_number or voucher_number for its order allocations.");
}

export function validateSalesOrderItem({ amount, name, qty, rate }) {
  if (!name || !Number.isFinite(qty) || !Number.isFinite(rate) || !Number.isFinite(amount)) throw new TypeError("Each sales order item requires item_name, quantity, and rate.");
}
