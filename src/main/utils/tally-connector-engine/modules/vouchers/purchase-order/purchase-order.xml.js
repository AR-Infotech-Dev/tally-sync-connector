import { renderXmlTemplate } from "../../../shared/template/templateRenderer.js";
import { buildUdfFields } from "../../../shared/mappers/udfXml.js";
import { escapeXml, buildImportEnvelope, toTallyDate, buildOrderDueDateXml } from "../../../shared/utils/xmlHelpers.js";

export function buildPurchaseOrderXml({ companyName, order = {} } = {}) {
  const data = order;
  const defaultType = "Purchase Order";
  const header = data.header || data;
  const items = header.items || header.line_items || header.lineItems;
  if (!Array.isArray(items) || !items.length) throw new TypeError(`${defaultType} must include a non-empty items array.`);
  const date = toTallyDate(header.date || header.voucher_date || header.order_date);
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger || header.supplier_name || header.party_ledger_entry?.ledger;
  if (!party) throw new TypeError(`${defaultType} requires party.ledger_name or supplier_ledger.`);
  const voucherType = header.voucher_type || defaultType;
  const voucherNo = header.voucher_number || header.reference || "";
  const orderNo = header.order_number || header.purchase_order_number || "";
  const supplierInvoiceNo = header.supplier_invoice_number || header.supplier_invoice_no || "";
  const supplierInvoiceDate = header.supplier_invoice_date || header.supplier_invoice_date_of_invoice;
  const supplierInvoiceDateXml = false && supplierInvoiceDate ? toTallyDate(supplierInvoiceDate) : "";
  const company = companyName || data.destination?.company || data.destination?.company_name || header.company?.name;
  const entries = items.map(item => {
    const name = item.stock_item || item.item_name || item.name;
    const quantity = Number(item.quantity ?? item.qty);
    const rate = Number(item.rate ?? item.unit_rate);
    const amount = Number(item.amount ?? quantity * rate);
    if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(rate) || !Number.isFinite(amount)) {
      throw new TypeError(`Each ${defaultType} item requires stock_item, positive quantity, and rate.`);
    }
    const unit = item.unit || "";
    const signedAmount = Math.abs(amount);
    const purchaseLedger = item.purchase_ledger || header.purchase_ledger;
    const accounting = purchaseLedger ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-19.xml.hbs", {
      purchaseLedger: escapeXml(purchaseLedger),
      signedAmount: signedAmount
    }) : "";
    const batch = item.batch || {};
    const batchName = batch.name || item.batch_name || "Primary Batch";
    const godownName = batch.godown || item.godown || "Main Location";
    const itemOrderNo = item.order_number || item.purchase_order_number || orderNo;
    const orderDueDateXml = buildOrderDueDateXml(item.order_due_date || header.order_due_date);
    const batchXml = batchName || godownName || true ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-12.xml.hbs", {
      value0: batch.manufactured_on ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-13.xml.hbs", {
        value0: toTallyDate(batch.manufactured_on)
      }) : "",
      value1: godownName ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-14.xml.hbs", {
        godownName: escapeXml(godownName)
      }) : "",
      value2: batchName ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-15.xml.hbs", {
        batchName: escapeXml(batchName)
      }) : "",
      value3: true && itemOrderNo ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-16.xml.hbs", {
        itemOrderNo: escapeXml(itemOrderNo)
      }) : "",
      value4: false && godownName ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-17.xml.hbs", {
        godownName: escapeXml(godownName)
      }) : "",
      signedAmount: signedAmount,
      quantity: quantity,
      value7: unit ? ` ${escapeXml(unit)}` : "",
      quantity8: quantity,
      value9: unit ? ` ${escapeXml(unit)}` : "",
      orderDueDateXml: orderDueDateXml,
      value11: batch.expiry_date ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-18.xml.hbs", {
        batchExpiry_date: escapeXml(batch.expiry_date)
      }) : ""
    }) : "";
    return renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-10.xml.hbs", {
      name: escapeXml(name),
      value1: false && itemOrderNo ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-11.xml.hbs", {
        itemOrderNo: escapeXml(itemOrderNo)
      }) : "",
      rate: rate,
      value3: unit ? `/${escapeXml(unit)}` : "",
      signedAmount: signedAmount,
      quantity: quantity,
      value6: unit ? ` ${escapeXml(unit)}` : "",
      quantity7: quantity,
      value8: unit ? ` ${escapeXml(unit)}` : "",
      batchXml: batchXml,
      accounting: accounting
    });
  }).join("");
  const total = Math.abs(Number(header.total_amount ?? items.reduce((sum, item) => sum + Math.abs(Number(item.amount ?? Number(item.quantity ?? item.qty) * Number(item.rate ?? item.unit_rate))), 0)));
  if (!Number.isFinite(total) || total <= 0) throw new TypeError(`${defaultType} total_amount must be greater than zero.`);
  const partyEntry = header.party_ledger_entry || {};
  const billReference = partyEntry.bill_reference || header.bill_reference || voucherNo;
  const billType = partyEntry.bill_type || header.bill_type || "New Ref";
  const partyAmount = Math.abs(Number(partyEntry.amount ?? total));
  const partyXml = renderXmlTemplate("shared/XML/purchaseInventoryXml-partyXml-8.xml.hbs", {
    value0: escapeXml(partyEntry.ledger || party),
    partyAmount: partyAmount,
    value2: false && billReference ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-9.xml.hbs", {
      billReference: escapeXml(billReference),
      billType: escapeXml(billType),
      partyAmount: partyAmount
    }) : ""
  });
  const customFields = header.custom_fields || data.custom_fields || {};
  const customXml = buildUdfFields(customFields, "Use a Tally UDF field name and scalar value.");
  const view = "Invoice Voucher View";
  const voucher = renderXmlTemplate("modules/vouchers/purchase-order/purchase-order.xml.hbs", {
    voucherType: escapeXml(voucherType),
    view: view,
    date: date,
    date3: date,
    voucherTypeValue: escapeXml(voucherType),
    value5: voucherNo ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-2.xml.hbs", {
      voucherNo: escapeXml(voucherNo)
    }) : "",
    value6: false && orderNo ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-3.xml.hbs", {
      orderNo: escapeXml(orderNo)
    }) : "",
    value7: true && (header.reference || orderNo) ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-5.xml.hbs", {
      value0: escapeXml(header.reference || orderNo)
    }) : supplierInvoiceNo ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-4.xml.hbs", {
      supplierInvoiceNo: escapeXml(supplierInvoiceNo)
    }) : "",
    value8: supplierInvoiceDateXml ? renderXmlTemplate("shared/XML/purchaseInventoryXml-fragment-6.xml.hbs", {
      supplierInvoiceDateXml: supplierInvoiceDateXml
    }) : "",
    party: escapeXml(party),
    value10: "No",
    view11: view,
    value12: "",
    date13: date,
    entries: entries,
    partyXml: partyXml,
    customXml: customXml
  });
  return buildImportEnvelope({
    companyName: company,
    messages: [voucher]
  });
}
