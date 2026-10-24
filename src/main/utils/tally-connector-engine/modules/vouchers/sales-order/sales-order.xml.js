import { renderXmlTemplate } from "../../../shared/template/templateRenderer.js";
import { buildUdfFields } from "../../../shared/mappers/udfXml.js";
import {escapeXml,buildImportEnvelope,toTallyDate,buildOrderDueDateXml} from "../../../shared/utils/xmlHelpers.js";

export function buildSalesOrderXml({ companyName, order = {}, orderVoucher } = {}) {
  const header = order.header || order;
  const items = order.items || order.line_items || order.lineItems;
  if (!Array.isArray(items) || items.length === 0) throw new TypeError("Sales order must include a non-empty items array.");
  const dateInput = header.date || header.voucher_date || header.order_date;
  const date = toTallyDate(dateInput);
  const voucherNo = header.voucher_number || header.order_number || header.reference || "";
  const partyDetails = header.party || {};
  const consignee = header.consignee || {};
  const companyDetails = header.company || {};
  const partyEntry = header.party_ledger_entry || {};
  const party = header.party_ledger || header.party_name || header.customer_ledger || header.customer_name || partyDetails.ledger_name || partyEntry.ledger;
  if (!party) throw new TypeError("Sales order requires party.ledger_name, party_ledger_entry.ledger, or party_ledger.");
  const voucherType = header.voucher_type || header.voucherType || "Sales Order";
  const isOrder = orderVoucher ?? String(voucherType).trim().toLowerCase() === "sales order";
  const orderNo = header.order_number || voucherNo;
  if (isOrder && !String(orderNo).trim()) throw new TypeError("Sales Order requires order_number or voucher_number for its order allocations.");
  const isInvoice = isOrder ? false : header.is_invoice ?? (String(header.voucher_mode || "").toLowerCase().includes("invoice"));
  const company = companyName || order.destination?.company || order.destination?.company_name || companyDetails.name;
  const entries = items.map((item) => {
    const name = item.stock_item || item.item_name || item.name;
    const qty = Number(item.quantity ?? item.qty);
    const rate = Number(item.rate ?? item.unit_rate);
    const amount = Number(item.amount ?? qty * rate);
    const actualQty = Number(item.actual_quantity ?? qty);
    const actualUnit = item.actual_unit || item.unit;
    if (!name || !Number.isFinite(qty) || !Number.isFinite(rate) || !Number.isFinite(amount)) {
      throw new TypeError("Each sales order item requires item_name, quantity, and rate.");
    }
    const billedUnit = item.unit || "";
    const rateUnit = item.rate_unit || billedUnit;
    const rateText = `${rate}${rateUnit ? `/${escapeXml(rateUnit)}` : ""}`;
    const amountText = escapeXml(Math.abs(amount));
    const batch = item.batch || {};
    const batchName = batch.name || (isOrder ? item.batch_name || "Primary Batch" : "");
    const godownName = batch.godown || (isOrder ? item.godown || "Main Location" : "");
    const itemOrderNo = item.order_number || orderNo;
    const orderDueDateXml = isOrder ? buildOrderDueDateXml(item.order_due_date || header.order_due_date) : "";
    const tallyQuantity = actualUnit && billedUnit && (actualUnit !== billedUnit || actualQty !== qty)
      ? ` ${escapeXml(qty)} ${escapeXml(billedUnit)} =  ${escapeXml(actualQty)} ${escapeXml(actualUnit)}`
      : ` ${escapeXml(qty)}${billedUnit ? ` ${escapeXml(billedUnit)}` : ""}`;
    const batchDate = (value) => value ? toTallyDate(value) : "";
    const expiryDate = batch.expiry_date ? toTallyDate(batch.expiry_date) : "";
    const expiryDisplay = expiryDate
      ? `${expiryDate.slice(6, 8)}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(expiryDate.slice(4, 6)) - 1]}-${expiryDate.slice(2, 4)}`
      : "";
    const batchAllocation = batchName || isOrder ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-30.xml.hbs", { value0: batch.manufactured_on ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-31.xml.hbs", { value0: batchDate(batch.manufactured_on) }) : "", godownName: escapeXml(godownName), batchName: escapeXml(batchName), value3: isOrder ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-32.xml.hbs", { itemOrderNo: escapeXml(itemOrderNo) }) : "", value4: !isOrder ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-33.xml.hbs", { godownName: escapeXml(godownName) }) : "", amountText: amountText, tallyQuantity: tallyQuantity, tallyQuantity7: tallyQuantity, orderDueDateXml: orderDueDateXml, value9: expiryDisplay ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-34.xml.hbs", { expiryDisplay: escapeXml(expiryDisplay) }) : "" }) : "";
    const accountingLedger = item.sales_ledger ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-29.xml.hbs", { itemSales_ledger: escapeXml(item.sales_ledger), amountText: amountText }) : "";
    const supplyType = item.supply_type ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-28.xml.hbs", { itemSupply_type: escapeXml(item.supply_type) }) : "";
    const taxability = item.taxability ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-27.xml.hbs", { itemTaxability: escapeXml(item.taxability) }) : "";
    const hsn = item.hsn_code ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-26.xml.hbs", { itemHsn_code: escapeXml(item.hsn_code) }) : "";
    return renderXmlTemplate("shared/XML/salesInventoryXml-fragment-25.xml.hbs", { name: escapeXml(name), supplyType: supplyType, taxability: taxability, hsn: hsn, rateText: rateText, amountText: amountText, tallyQuantity: tallyQuantity, tallyQuantity7: tallyQuantity, batchAllocation: batchAllocation, accountingLedger: accountingLedger });
  }).join("");
  const addressLines = [partyDetails.address, partyDetails.address_2].filter(Boolean).map((line) => renderXmlTemplate("shared/XML/salesInventoryXml-fragment-24.xml.hbs", { line: escapeXml(line) })).join("");
  const partyAmount = Number(partyEntry.amount ?? (isOrder ? -items.reduce((sum, item) => sum + Math.abs(Number(item.amount ?? Number(item.quantity ?? item.qty) * Number(item.rate ?? item.unit_rate))), 0) : 0));
  const partyLedgerXml = renderXmlTemplate("shared/XML/salesInventoryXml-partyLedgerXml-22.xml.hbs", { value0: escapeXml(partyEntry.ledger || party), value1: partyAmount < 0 ? "Yes" : "No", value2: partyAmount < 0 ? "Yes" : "No", partyAmount: escapeXml(partyAmount), value4: partyEntry.bill_reference ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-23.xml.hbs", { partyEntryBill_reference: escapeXml(partyEntry.bill_reference), value1: escapeXml(partyEntry.bill_type || "New Ref"), partyAmount: escapeXml(partyAmount) }) : "" });
  const mailing = renderXmlTemplate("shared/XML/salesInventoryXml-mailing-16.xml.hbs", { value0: escapeXml(partyDetails.buyer_name || party), value1: escapeXml(partyDetails.buyer_name || partyDetails.mailing_name || party), value2: escapeXml(partyDetails.mailing_name || party), value3: partyDetails.pincode ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-17.xml.hbs", { partyDetailsPincode: escapeXml(partyDetails.pincode) }) : "", value4: partyDetails.state ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-18.xml.hbs", { partyDetailsState: escapeXml(partyDetails.state) }) : "", value5: partyDetails.country ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-19.xml.hbs", { partyDetailsCountry: escapeXml(partyDetails.country) }) : "", value6: partyDetails.gstin ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-20.xml.hbs", { partyDetailsGstin: escapeXml(partyDetails.gstin) }) : "", value7: partyDetails.gst_registration_type ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-21.xml.hbs", { partyDetailsGst_registration_type: escapeXml(partyDetails.gst_registration_type), partyDetailsGst_registration_typeValue: escapeXml(partyDetails.gst_registration_type) }) : "", addressLines: addressLines });
  const consigneeXml = consignee.name ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-12.xml.hbs", { consigneeName: escapeXml(consignee.name), value1: consignee.pincode ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-13.xml.hbs", { consigneePincode: escapeXml(consignee.pincode) }) : "", value2: consignee.state ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-14.xml.hbs", { consigneeState: escapeXml(consignee.state) }) : "", value3: consignee.country ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-15.xml.hbs", { consigneeCountry: escapeXml(consignee.country) }) : "" }) : "";
  const companyRegistration = companyDetails.gst_registration
    ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-11.xml.hbs", { value0: escapeXml(companyDetails.gstin || ""), companyDetailsGst_registration: escapeXml(companyDetails.gst_registration) })
    : "";
  const gstCompany = `${companyDetails.gstin ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-10.xml.hbs", { companyDetailsGstin: escapeXml(companyDetails.gstin) }) : ""}${companyDetails.gst_registration_type ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-9.xml.hbs", { companyDetailsGst_registration_type: escapeXml(companyDetails.gst_registration_type) }) : ""}${companyDetails.state ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-8.xml.hbs", { companyDetailsState: escapeXml(companyDetails.state) }) : ""}`;
  const placeOfSupply = header.place_of_supply ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-7.xml.hbs", { headerPlace_of_supply: escapeXml(header.place_of_supply) }) : "";
  const customFields = buildUdfFields(header.custom_fields || order.custom_fields || {});
  const voucherView = isOrder || isInvoice ? "Invoice Voucher View" : "Accounting Voucher View";
  const voucher = renderXmlTemplate(isOrder ? "modules/vouchers/sales-order/sales-order.xml.hbs" : "modules/vouchers/sales/sales.xml.hbs", { voucherType: escapeXml(voucherType), voucherView: voucherView, date: escapeXml(date), dateValue: escapeXml(date), voucherTypeValue: escapeXml(voucherType), voucherNo: escapeXml(voucherNo), value6: isOrder ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-2.xml.hbs", { value0: escapeXml(header.reference || orderNo) }) : "", party: escapeXml(party), value8: partyDetails.gst_registration_type ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-3.xml.hbs", { partyDetailsGst_registration_type: escapeXml(partyDetails.gst_registration_type) }) : "", value9: companyDetails.state ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-4.xml.hbs", { companyDetailsState: escapeXml(companyDetails.state) }) : "", value10: partyDetails.country ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-5.xml.hbs", { partyDetailsCountry: escapeXml(partyDetails.country) }) : "", placeOfSupply: placeOfSupply, companyRegistration: companyRegistration, gstCompany: gstCompany, mailing: mailing, value15: escapeXml(partyDetails.mailing_name || party), consigneeXml: consigneeXml, value17: isInvoice ? "Yes" : "No", voucherView18: voucherView, value19: !isOrder ? renderXmlTemplate("shared/XML/salesInventoryXml-fragment-6.xml.hbs", { value0: escapeXml(header.voucher_mode || (isInvoice ? "Item Invoice" : "Accounting Invoice")) }) : "", dateValueValue: escapeXml(date), entries: entries, partyLedgerXml: partyLedgerXml, customFields: customFields });
  return buildImportEnvelope({ companyName: company, messages: [voucher] });
}
