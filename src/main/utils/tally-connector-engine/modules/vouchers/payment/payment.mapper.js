import {
  validatePaymentParty,
  validatePaymentPaymentLedger,
  validatePaymentAmount,
} from "./payment.validator.js";
import { escapeXml, toTallyDate } from "../../../shared/utils/xmlHelpers.js";
import { mapUdfFields } from "../../../shared/mappers/udfXml.js";

export function mapPaymentToTemplate({ companyName, payment = {} } = {}) {
  const data = payment;
  const label = "Payment";
  const header = data.header || data;
  const date = toTallyDate(header.date || header.voucher_date);
  const voucherType = header.voucher_type || label;
  const voucherNo = header.voucher_number || header.reference || "";
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger;
  const paymentLedger = header.payment?.ledger_name || header.payment_ledger;
  const amount = Math.abs(Number(header.amount));

  validatePaymentParty({ party });
  validatePaymentPaymentLedger({ paymentLedger, label });
  validatePaymentAmount({ label, amount });
  const company = companyName || data.destination?.company || data.destination?.company_name;
  // Payment: debit supplier (negative Tally amount), credit Cash/Bank.
  const partyAmount = -amount;
  const paymentAmount = -partyAmount;
  const billReference = header.bill_reference;
  const billType = header.bill_type || (billReference ? "Agst Ref" : "On Account");

  // Each posting is plain data; HBS renders the optional bill reference.
  const partyPosting = {
    ledger: escapeXml(party),
    isParty: "Yes",
    positive: "Yes",
    amount: partyAmount,
    billReference: escapeXml(billReference),
    billType: escapeXml(billType),
  };
  const cashPosting = {
    ledger: escapeXml(paymentLedger),
    isParty: "No",
    positive: "No",
    amount: paymentAmount,
    billReference: "",
    billType: "",
  };
  return {
    companyName: company,
    template: "modules/vouchers/payment/payment.xml.hbs",
    context: {
      date,
      voucherType: escapeXml(voucherType),
      voucherNo: escapeXml(voucherNo),
      party: escapeXml(party),
      ledgerEntries: [partyPosting, cashPosting],
      customFields: mapUdfFields(
        header.custom_fields || {},
        "Use a Tally UDF field name and scalar value.",
      ),
    },
  };
}
