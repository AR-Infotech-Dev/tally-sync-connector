// Keep voucher rules here. Date and due-date validation remain in shared date helpers.
export function validatePaymentParty({ party }) {
  if (!party) throw new TypeError("Payment voucher requires party.ledger_name (supplier ledger).");
}

export function validatePaymentPaymentLedger({ paymentLedger, label }) {
  if (!paymentLedger) throw new TypeError(`${label} voucher requires payment.ledger_name (Cash or Bank ledger).`);
}

export function validatePaymentAmount({ label, amount }) {
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError(`${label} voucher amount must be greater than zero.`);
}
