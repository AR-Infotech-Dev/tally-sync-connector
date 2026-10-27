import { validateReceiptParty, validateReceiptPaymentLedger, validateReceiptAmount } from "./receipt.validator.js";
import { escapeXml, toTallyDate } from "../../../shared/utils/xmlHelpers.js";
import { mapUdfFields } from "../../../shared/mappers/udfXml.js";

export function mapReceiptToTemplate({ companyName, receipt = {} } = {}) {
  const data = receipt;
  const label = "Receipt";
  const header = data.header || data;
  const date = toTallyDate(header.date || header.voucher_date);
  const voucherType = header.voucher_type || label;
  const voucherNo = header.voucher_number || header.reference || "";
  const party = header.party?.ledger_name || header.party_ledger || undefined;
  const paymentLedger = header.payment?.ledger_name || header.payment_ledger;
  const amount = Math.abs(Number(header.amount));
  validateReceiptParty({ party });
  validateReceiptPaymentLedger({ paymentLedger, label });
  validateReceiptAmount({ label, amount });
  const company = companyName || data.destination?.company || data.destination?.company_name;
  // Receipt: credit customer (positive Tally amount), debit Cash/Bank.
  const partyAmount = amount;
  const paymentAmount = -partyAmount;
  const billReference = header.bill_reference;
  const billType = header.bill_type || (billReference ? "Agst Ref" : "On Account");

  // Each posting is plain data; HBS renders the optional bill reference.
  const partyPosting = {ledger:escapeXml(party),isParty:"Yes",positive:"No",amount:partyAmount,billReference:escapeXml(billReference),billType:escapeXml(billType)};
  const cashPosting = {ledger:escapeXml(paymentLedger),isParty:"No",positive:"Yes",amount:paymentAmount,billReference:"",billType:""};
  return {
    companyName: company, template:"modules/vouchers/receipt/receipt.xml.hbs",
    context: {
      date,voucherType:escapeXml(voucherType),voucherNo:escapeXml(voucherNo),party:escapeXml(party),
      ledgerEntries:[cashPosting,partyPosting],
      customFields:mapUdfFields(header.custom_fields || {}, undefined),
    },
  };
}
