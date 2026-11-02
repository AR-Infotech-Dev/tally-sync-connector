// Keep voucher rules here. Date and due-date validation remain in shared date helpers.
export function validateSalesItems({ items }) {
  if (!Array.isArray(items) || items.length === 0)
    throw new TypeError("Sales voucher must include a non-empty items array.");
}

export function validateSalesParty({ party }) {
  if (!party)
    throw new TypeError(
      "Sales voucher requires party.ledger_name, party_ledger_entry.ledger, or party_ledger.",
    );
}

export function validateSalesItem({ amount, name, qty, rate }) {
  if (!name || !Number.isFinite(qty) || !Number.isFinite(rate) || !Number.isFinite(amount))
    throw new TypeError("Each sales voucher item requires item_name, quantity, and rate.");
}
