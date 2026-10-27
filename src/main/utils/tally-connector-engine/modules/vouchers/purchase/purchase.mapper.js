import { validatePurchaseItems, validatePurchaseParty, validatePurchaseItem, validatePurchaseTotal } from "./purchase.validator.js";
import { mapUdfFields } from "../../../shared/mappers/udfXml.js";
import { escapeXml, toTallyDate, mapOrderDueDate } from "../../../shared/utils/xmlHelpers.js";
export function mapPurchaseToTemplate({ companyName, purchase = {} } = {}) {
  const data = purchase;
  const defaultType = "Purchase";
  const header = data.header || data;
  const items = header.items || header.line_items || header.lineItems;
  validatePurchaseItems({ items, defaultType });
  const date = toTallyDate(header.date || header.voucher_date || header.order_date);
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger || header.supplier_name || header.party_ledger_entry?.ledger;
  validatePurchaseParty({ defaultType, party });
  const voucherType = header.voucher_type || defaultType;
  const voucherNo = header.voucher_number || header.reference || "";
  const orderNo = header.order_number || header.purchase_order_number || "";
  const supplierInvoiceNo = header.supplier_invoice_number || header.supplier_invoice_no || header.reference;
  const supplierInvoiceDate = header.supplier_invoice_date || header.supplier_invoice_date_of_invoice;
  const supplierInvoiceDateXml = true && supplierInvoiceDate ? toTallyDate(supplierInvoiceDate) : "";
  const company = companyName || data.destination?.company || data.destination?.company_name || header.company?.name;

  const isOrder = false;
  // Amounts and validation stay in JS; optional XML tags and loops stay in HBS.
  const entries = items.map(item => {
    const name = item.stock_item || item.item_name || item.name;
    const quantity = Number(item.quantity ?? item.qty);
    const rate = Number(item.rate ?? item.unit_rate);
    const amount = Number(item.amount ?? quantity * rate);
    validatePurchaseItem({ defaultType, amount, name, quantity, rate });
    const unit = item.unit || "";
    const batch = item.batch || {};
    const batchName = batch.name || item.batch_name || (isOrder ? "Primary Batch" : "");
    const godown = batch.godown || item.godown || (isOrder ? "Main Location" : "");
    return {
      name: escapeXml(name), quantity: ` ${quantity}${unit ? " " + escapeXml(unit) : ""}`,
      rate: `${rate}${unit ? "/" + escapeXml(unit) : ""}`,
      amount: -Math.abs(amount), purchaseLedger: escapeXml(item.purchase_ledger || header.purchase_ledger),
      orderNo: escapeXml(item.order_number || item.purchase_order_number || orderNo),
      hasBatch: Boolean(batchName || godown || isOrder), batchName: escapeXml(batchName), godown: escapeXml(godown),
      manufacturedOn: (batchName || godown || isOrder) && batch.manufactured_on ? toTallyDate(batch.manufactured_on) : "",
      expiry: escapeXml(batch.expiry_date),
      dueDate: isOrder ? mapOrderDueDate(item.order_due_date || header.order_due_date) : null,
    };
  });
  const total = Math.abs(Number(header.total_amount ?? items.reduce((sum, item) => sum + Math.abs(Number(item.amount ?? Number(item.quantity ?? item.qty) * Number(item.rate ?? item.unit_rate))), 0)));
  validatePurchaseTotal({ defaultType, total });
  const partyEntry = header.party_ledger_entry || {};
  const billReference = partyEntry.bill_reference || header.bill_reference || voucherNo;
  return {
    companyName: company, template: "modules/vouchers/purchase/purchase.xml.hbs",
    context: {
      date, voucherType: escapeXml(voucherType), voucherNo: escapeXml(voucherNo), isOrder,
      orderNo: escapeXml(orderNo), reference: escapeXml(isOrder ? header.reference || orderNo || supplierInvoiceNo : supplierInvoiceNo),
      supplierInvoiceDate: supplierInvoiceDateXml, party: escapeXml(party), isInvoice: isOrder ? "No" : "Yes",
      voucherMode: escapeXml(header.voucher_mode || "Item Invoice"), entries,
      partyLedger: escapeXml(partyEntry.ledger || party), partyAmount: Math.abs(Number(partyEntry.amount ?? total)),
      billReference: isOrder ? "" : escapeXml(billReference), billType: escapeXml(partyEntry.bill_type || header.bill_type || "New Ref"),
      customFields: mapUdfFields(header.custom_fields || data.custom_fields || {}, "Use a Tally UDF field name and scalar value."),
    },
  };
}
