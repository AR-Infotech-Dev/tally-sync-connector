import { renderXmlTemplate } from "../../../shared/template/templateRenderer.js";
import { escapeXml, buildImportEnvelope, toTallyDate } from "../../../shared/utils/xmlHelpers.js";
import { buildUdfFields } from "../../../shared/mappers/udfXml.js";

export function buildPaymentVoucherXml({ companyName, payment = {} } = {}) {
  const data = payment;
  const label = "Payment";
  const header = data.header || data;
  const date = toTallyDate(header.date || header.voucher_date);
  const voucherType = header.voucher_type || label;
  const voucherNo = header.voucher_number || header.reference || "";
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger;
  const paymentLedger = header.payment?.ledger_name || header.payment_ledger;
  const amount = Math.abs(Number(header.amount));
  
  if (!party) throw new TypeError("Payment voucher requires party.ledger_name (supplier ledger).");
  if (!paymentLedger) throw new TypeError(`${label} voucher requires payment.ledger_name (Cash or Bank ledger).`);
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError(`${label} voucher amount must be greater than zero.`);
  const company = companyName || data.destination?.company || data.destination?.company_name;
  const partyAmount = -amount;
  const paymentAmount = -partyAmount;
  const billReference = header.bill_reference;
  const billType = header.bill_type || (billReference ? "Agst Ref" : "On Account");
  const billAllocation = billReference ? renderXmlTemplate("shared/XML/cashBankVoucherXml-fragment-4.xml.hbs", {
    billReference: escapeXml(billReference),
    billType: escapeXml(billType),
    partyAmount: partyAmount
  }) : "";
  const partyEntry = renderXmlTemplate("shared/XML/cashBankVoucherXml-partyEntry-3.xml.hbs", {
    party: escapeXml(party),
    value1: "Yes",
    partyAmount: partyAmount,
    billAllocation: billAllocation
  });
  const paymentEntry = renderXmlTemplate("shared/XML/cashBankVoucherXml-paymentEntry-2.xml.hbs", {
    paymentLedger: escapeXml(paymentLedger),
    value1: "No",
    paymentAmount: paymentAmount
  });
  const customXml = buildUdfFields(header.custom_fields || {}, "Use a Tally UDF field name and scalar value.");
  const ledgerEntries = partyEntry + paymentEntry;
  const voucher = renderXmlTemplate("modules/vouchers/payment/payment.xml.hbs", {
    voucherType: escapeXml(voucherType),
    date: date,
    date2: date,
    voucherTypeValue: escapeXml(voucherType),
    voucherNo: escapeXml(voucherNo),
    party: escapeXml(party),
    date6: date,
    ledgerEntries: ledgerEntries,
    customXml: customXml
  });
  return buildImportEnvelope({
    companyName: company,
    messages: [voucher]
  });
}
