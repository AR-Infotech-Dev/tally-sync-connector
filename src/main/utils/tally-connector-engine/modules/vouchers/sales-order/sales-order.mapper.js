import {
  validateSalesOrderItems,
  validateSalesOrderParty,
  validateSalesOrderOrderNumber,
  validateSalesOrderItem,
} from "./sales-order.validator.js";
import { mapUdfFields } from "../../../shared/mappers/udfXml.js";
import { escapeXml, toTallyDate, mapOrderDueDate } from "../../../shared/utils/xmlHelpers.js";

export function mapSalesOrderToTemplate({ companyName, order = {}, orderVoucher } = {}) {
  const header = order.header || order;
  const items = order.items || order.line_items || order.lineItems;
  validateSalesOrderItems({ items });
  const dateInput = header.date || header.voucher_date || header.order_date;
  const date = toTallyDate(dateInput);
  const voucherNo = header.voucher_number || header.order_number || header.reference || "";
  const partyDetails = header.party || {};
  const consignee = header.consignee || {};
  const companyDetails = header.company || {};
  const partyEntry = header.party_ledger_entry || {};
  const party =
    header.party_ledger ||
    header.party_name ||
    header.customer_ledger ||
    header.customer_name ||
    partyDetails.ledger_name ||
    partyEntry.ledger;
  validateSalesOrderParty({ party });
  const voucherType = header.voucher_type || header.voucherType || "Sales Order";
  const isOrder = orderVoucher ?? String(voucherType).trim().toLowerCase() === "sales order";
  const orderNo = header.order_number || voucherNo;
  validateSalesOrderOrderNumber({ isOrder, orderNo });
  // Orders must not be imported as invoices; Tally otherwise raises allocation exceptions.
  const isInvoice = isOrder
    ? false
    : (header.is_invoice ??
      String(header.voucher_mode || "")
        .toLowerCase()
        .includes("invoice"));
  const company =
    companyName ||
    order.destination?.company ||
    order.destination?.company_name ||
    companyDetails.name;

  // Data only: all optional XML sections and item loops live in the voucher HBS.
  const entries = items.map((item) => {
    const name = item.stock_item || item.item_name || item.name;
    const qty = Number(item.quantity ?? item.qty);
    const rate = Number(item.rate ?? item.unit_rate);
    const amount = Number(item.amount ?? qty * rate);
    validateSalesOrderItem({ amount, name, qty, rate });
    const actualQty = Number(item.actual_quantity ?? qty);
    const actualUnit = item.actual_unit || item.unit;
    const unit = item.unit || "";
    const rateUnit = item.rate_unit || unit;
    const batch = item.batch || {};
    const batchName = batch.name || (isOrder ? item.batch_name || "Primary Batch" : "");
    const godown = batch.godown || (isOrder ? item.godown || "Main Location" : "");
    const expiryDate = batch.expiry_date ? toTallyDate(batch.expiry_date) : "";
    const expiry = expiryDate
      ? `${expiryDate.slice(6, 8)}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(expiryDate.slice(4, 6)) - 1]}-${expiryDate.slice(2, 4)}`
      : "";
    return {
      name: escapeXml(name),
      amount: escapeXml(Math.abs(amount)),
      rate: `${rate}${rateUnit ? "/" + escapeXml(rateUnit) : ""}`,
      quantity:
        actualUnit && unit && (actualUnit !== unit || actualQty !== qty)
          ? ` ${escapeXml(qty)} ${escapeXml(unit)} =  ${escapeXml(actualQty)} ${escapeXml(actualUnit)}`
          : ` ${escapeXml(qty)}${unit ? " " + escapeXml(unit) : ""}`,
      supplyType: escapeXml(item.supply_type),
      taxability: escapeXml(item.taxability),
      hsn: escapeXml(item.hsn_code),
      salesLedger: escapeXml(item.sales_ledger),
      hasBatch: Boolean(batchName || isOrder),
      batchName: escapeXml(batchName),
      godown: escapeXml(godown),
      manufacturedOn:
        (batchName || isOrder) && batch.manufactured_on ? toTallyDate(batch.manufactured_on) : "",
      expiry: escapeXml(expiry),
      orderNo: escapeXml(item.order_number || orderNo),
      dueDate: isOrder ? mapOrderDueDate(item.order_due_date || header.order_due_date) : null,
    };
  });
  const partyAmount = Number(
    partyEntry.amount ??
      (isOrder
        ? -items.reduce(
            (sum, item) =>
              sum +
              Math.abs(
                Number(
                  item.amount ??
                    Number(item.quantity ?? item.qty) * Number(item.rate ?? item.unit_rate),
                ),
              ),
            0,
          )
        : 0),
  );
  const scalarFields = (value) =>
    Object.fromEntries(
      Object.entries({ gstin: "", ...value })
        .filter(([, v]) => v !== null && typeof v !== "object")
        .map(([key, v]) => [key, escapeXml(v)]),
    );
  return {
    companyName: company,
    template: isOrder
      ? "modules/vouchers/sales-order/sales-order.xml.hbs"
      : "modules/vouchers/sales/sales.xml.hbs",
    context: {
      voucherType: escapeXml(voucherType),
      voucherView: isOrder || isInvoice ? "Invoice Voucher View" : "Accounting Voucher View",
      date,
      voucherNo: escapeXml(voucherNo),
      isOrder,
      isInvoice: isInvoice ? "Yes" : "No",
      reference: escapeXml(header.reference || orderNo),
      party: escapeXml(party),
      partyDetails: scalarFields(partyDetails),
      companyDetails: scalarFields(companyDetails),
      consignee: scalarFields(consignee),
      buyerName: escapeXml(partyDetails.buyer_name || party),
      buyerMailingName: escapeXml(partyDetails.buyer_name || partyDetails.mailing_name || party),
      mailingName: escapeXml(partyDetails.mailing_name || party),
      addresses: [partyDetails.address, partyDetails.address_2].filter(Boolean).map(escapeXml),
      placeOfSupply: escapeXml(header.place_of_supply),
      voucherMode: escapeXml(
        header.voucher_mode || (isInvoice ? "Item Invoice" : "Accounting Invoice"),
      ),
      entries,
      partyLedger: escapeXml(partyEntry.ledger || party),
      partyAmount: escapeXml(partyAmount),
      partyPositive: partyAmount < 0 ? "Yes" : "No",
      billReference: escapeXml(partyEntry.bill_reference),
      billType: escapeXml(partyEntry.bill_type || "New Ref"),
      customFields: mapUdfFields(header.custom_fields || order.custom_fields || {}),
    },
  };
}
