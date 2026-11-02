// Keep voucher rules here. Date and due-date validation remain in shared date helpers.
export function validatePurchaseItems({ items, defaultType }) {
  if (!Array.isArray(items) || !items.length)
    throw new TypeError(`${defaultType} must include a non-empty items array.`);
}

export function validatePurchaseParty({ defaultType, party }) {
  if (!party) throw new TypeError(`${defaultType} requires party.ledger_name or supplier_ledger.`);
}

export function validatePurchaseItem({ defaultType, amount, name, quantity, rate }) {
  if (
    !name ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(rate) ||
    !Number.isFinite(amount)
  )
    throw new TypeError(
      `Each ${defaultType} item requires stock_item, positive quantity, and rate.`,
    );
}

export function validatePurchaseTotal({ defaultType, total }) {
  if (!Number.isFinite(total) || total <= 0)
    throw new TypeError(`${defaultType} total_amount must be greater than zero.`);
}
