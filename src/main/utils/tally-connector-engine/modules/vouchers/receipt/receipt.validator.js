// Keep voucher rules here. Date and due-date validation remain in shared date helpers.
export function validateReceiptParty({ party }) {
  if (!party) throw new TypeError("Receipt voucher requires party.ledger_name.");
}

export function validateReceiptPaymentLedger({ paymentLedger, label }) {
  if (!paymentLedger)
    throw new TypeError(`${label} voucher requires payment.ledger_name (Cash or Bank ledger).`);
}

export function validateReceiptAmount({ label, amount }) {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new TypeError(`${label} voucher amount must be greater than zero.`);
}
