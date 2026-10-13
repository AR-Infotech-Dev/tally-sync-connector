/**
 * Escapes a plain value for safe insertion into XML text or an attribute.
 *
 * @param {unknown} value Value to encode; nullish values become an empty string.
 * @returns {string} XML-escaped text.
 */
export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Builds the Tally collection export request used to discover open companies.
 *
 * @returns {string} A complete Tally XML export request.
 */
export function buildCompanyListRequest() {
  return [
    "<ENVELOPE>",
    "<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER>",
    "<BODY><DESC><TDL><TDLMESSAGE><COLLECTION NAME=\"List of Companies\" ISMODIFY=\"No\"><TYPE>Company</TYPE><FETCH>Name,GUID</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY>",
    "</ENVELOPE>",
  ].join("");
}

/**
 * Builds a generic TDL collection export request.
 *
 * @param {{collectionName: string, objectType: string, fetchFields: string[], companyName?: string}} definition Collection and fetch-field settings.
 * @returns {string} A complete Tally XML export request.
 * @throws {TypeError} If collection name, object type, or fetch fields are missing.
 */
export function buildCollectionRequest({ collectionName, objectType, fetchFields = [], companyName } = {}) {
  if (!collectionName || !objectType || !Array.isArray(fetchFields) || fetchFields.length === 0) {
    throw new TypeError("collectionName, objectType, and at least one fetchField are required.");
  }
  const name = escapeXml(collectionName);
  const company = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  const fields = escapeXml(fetchFields.join(","));
  return [
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>",
    `<ID>${name}</ID></HEADER><BODY><DESC><STATICVARIABLES>${company}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>`,
    `<TDL><TDLMESSAGE><COLLECTION NAME=\"${name}\" ISMODIFY=\"No\"><TYPE>${escapeXml(objectType)}</TYPE><FETCH>${fields}</FETCH></COLLECTION></TDLMESSAGE></TDL>`,
    "</DESC></BODY></ENVELOPE>",
  ].join("");
}

/** Builds an Object export that reads the Tally-assigned number for a voucher Master ID. */
export function buildVoucherLookupRequest({ companyName, voucherId } = {}) {
  if (!companyName || !String(companyName).trim()) throw new TypeError("A Tally company name is required to read a voucher.");
  if (!/^\d+$/.test(String(voucherId ?? ""))) throw new TypeError("A numeric Tally voucher ID is required to read a voucher.");
  return [
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE>",
    `<ID TYPE="Name">ID:${escapeXml(voucherId)}</ID></HEADER>`,
    "<BODY><DESC><STATICVARIABLES>",
    `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVViewName>Accounting Voucher View</SVViewName>`,
    "</STATICVARIABLES><FETCHLIST><FETCH>VoucherNumber</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>",
  ].join("");
}

/** Extracts the actual voucher number from a Tally Object export response. */
export function parseVoucherNumber(xml) {
  const match = String(xml || "").match(/<VOUCHERNUMBER\b[^>]*>([\s\S]*?)<\/VOUCHERNUMBER>/i);
  return match ? match[1].replace(/<[^>]*>/g, "").trim() : "";
}

/**
 * Wraps TALLYMESSAGE XML fragments in the standard Tally Import Data envelope.
 * Each message must already be a complete XML fragment, usually a TALLYMESSAGE
 * containing a VOUCHER or master. Escape individual field values before building it.
 *
 * @param {{companyName?: string, messages?: string[]}} options Company and XML fragments.
 * @returns {string} Complete Import Data envelope.
 * @throws {TypeError} If messages is not an array of non-empty strings.
 */
export function buildImportEnvelope({ companyName, messages = [] } = {}) {
  if (!Array.isArray(messages) || messages.some((message) => typeof message !== "string" || !message.trim())) {
    throw new TypeError("messages must be an array of non-empty Tally XML strings.");
  }
  const company = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return [
    "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA>",
    "<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>", company,
    "</STATICVARIABLES></REQUESTDESC><REQUESTDATA>", messages.join(""),
    "</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>",
  ].join("");
}

/** Builds a Tally All Masters import for creating ledger masters. */
export function buildLedgerMasterImport({ companyName, ledgers = [] } = {}) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) {
    throw new TypeError("At least one ledger master is required.");
  }
  const messages = ledgers.map(({ name, parent, billWise = false }) => {
    if (!name || !parent) throw new TypeError("Each ledger master requires a name and Tally parent group.");
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER Action="Create"><NAME>${escapeXml(name)}</NAME><PARENT>${escapeXml(parent)}</PARENT>${billWise ? "<ISBILLWISEON>Yes</ISBILLWISEON>" : ""}</LEDGER></TALLYMESSAGE>`;
  }).join("");
  const company = companyName ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>` : "";
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${company}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>${messages}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}

/** Converts supported CRM date formats to Tally's required YYYYMMDD format. */
function toTallyDate(value) {
  const input = String(value || "").trim();
  let year;
  let month;
  let day;
  let match;
  if ((match = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)) || (match = input.match(/^(\d{4})(\d{2})(\d{2})$/))) {
    [, year, month, day] = match;
  } else if ((match = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    [, day, month, year] = match;
    if (year.length === 2) year = `20${year}`;
  } else {
    throw new TypeError("Voucher date is required. Use YYYY-MM-DD or DD-MM-YYYY; Tally XML will receive YYYYMMDD.");
  }

  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  const parsed = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (parsed.getUTCFullYear() !== yyyy || parsed.getUTCMonth() !== mm - 1 || parsed.getUTCDate() !== dd) {
    throw new TypeError(`Invalid voucher date '${input}'. Use a real date in YYYY-MM-DD or DD-MM-YYYY format.`);
  }
  return `${String(yyyy).padStart(4, "0")}${String(mm).padStart(2, "0")}${String(dd).padStart(2, "0")}`;
}

/** Builds a basic Sales Order voucher from the Connector's canonical JSON shape. */
export function buildSalesOrderXml({ companyName, order = {} } = {}) {
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
  const isInvoice = header.is_invoice ?? (String(header.voucher_mode || "").toLowerCase().includes("invoice"));
  const company = companyName || order.destination?.company || order.destination?.company_name || companyDetails.name;
  const buildUdfFields = (fields = {}) => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new TypeError("custom_fields must be a JSON object.");
    return Object.entries(fields).map(([name, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || value === null || typeof value === "object") {
        throw new TypeError(`Unsupported custom field '${name}'. Use a Tally UDF field name and a scalar value.`);
      }
      return `<UDF:${name}>${escapeXml(value)}</UDF:${name}>`;
    }).join("");
  };
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
    const tallyQuantity = actualUnit && billedUnit && (actualUnit !== billedUnit || actualQty !== qty)
      ? ` ${escapeXml(qty)} ${escapeXml(billedUnit)} =  ${escapeXml(actualQty)} ${escapeXml(actualUnit)}`
      : ` ${escapeXml(qty)}${billedUnit ? ` ${escapeXml(billedUnit)}` : ""}`;
    const batchDate = (value) => value ? toTallyDate(value) : "";
    const expiryDate = batch.expiry_date ? toTallyDate(batch.expiry_date) : "";
    const expiryDisplay = expiryDate
      ? `${expiryDate.slice(6, 8)}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(expiryDate.slice(4, 6)) - 1]}-${expiryDate.slice(2, 4)}`
      : "";
    const batchAllocation = batch.name ? `<BATCHALLOCATIONS.LIST>${batch.manufactured_on ? `<MFDON>${batchDate(batch.manufactured_on)}</MFDON>` : ""}<GODOWNNAME>${escapeXml(batch.godown || "")}</GODOWNNAME><BATCHNAME>${escapeXml(batch.name)}</BATCHNAME><DESTINATIONGODOWNNAME>${escapeXml(batch.godown || "")}</DESTINATIONGODOWNNAME><AMOUNT>${amountText}</AMOUNT><ACTUALQTY>${tallyQuantity}</ACTUALQTY><BILLEDQTY>${tallyQuantity}</BILLEDQTY>${expiryDisplay ? `<EXPIRYPERIOD>${escapeXml(expiryDisplay)}</EXPIRYPERIOD>` : ""}</BATCHALLOCATIONS.LIST>` : "";
    const accountingLedger = item.sales_ledger ? `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${escapeXml(item.sales_ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${amountText}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` : "";
    const supplyType = item.supply_type ? `<GSTOVRDNTYPEOFSUPPLY>${escapeXml(item.supply_type)}</GSTOVRDNTYPEOFSUPPLY>` : "";
    const taxability = item.taxability ? `<GSTOVRDNTAXABILITY>${escapeXml(item.taxability)}</GSTOVRDNTAXABILITY>` : "";
    const hsn = item.hsn_code ? `<GSTHSNNAME>${escapeXml(item.hsn_code)}</GSTHSNNAME>` : "";
    return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${escapeXml(name)}</STOCKITEMNAME>${supplyType}${taxability}${hsn}<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><RATE>${rateText}</RATE><AMOUNT>${amountText}</AMOUNT><ACTUALQTY>${tallyQuantity}</ACTUALQTY><BILLEDQTY>${tallyQuantity}</BILLEDQTY>${batchAllocation}${accountingLedger}</ALLINVENTORYENTRIES.LIST>`;
  }).join("");
  const addressLines = [partyDetails.address, partyDetails.address_2].filter(Boolean).map((line) => `<ADDRESS>${escapeXml(line)}</ADDRESS>`).join("");
  const partyAmount = Number(partyEntry.amount ?? 0);
  const partyLedgerXml = `<LEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(partyEntry.ledger || party)}</LEDGERNAME><ISDEEMEDPOSITIVE>${partyAmount < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><ISLASTDEEMEDPOSITIVE>${partyAmount < 0 ? "Yes" : "No"}</ISLASTDEEMEDPOSITIVE><AMOUNT>${escapeXml(partyAmount)}</AMOUNT>${partyEntry.bill_reference ? `<BILLALLOCATIONS.LIST><NAME>${escapeXml(partyEntry.bill_reference)}</NAME><BILLTYPE>${escapeXml(partyEntry.bill_type || "New Ref")}</BILLTYPE><AMOUNT>${escapeXml(partyAmount)}</AMOUNT></BILLALLOCATIONS.LIST>` : ""}</LEDGERENTRIES.LIST>`;
  const mailing = `<PARTYNAME>${escapeXml(partyDetails.buyer_name || party)}</PARTYNAME><BASICBUYERNAME>${escapeXml(partyDetails.buyer_name || partyDetails.mailing_name || party)}</BASICBUYERNAME><PARTYMAILINGNAME>${escapeXml(partyDetails.mailing_name || party)}</PARTYMAILINGNAME>${partyDetails.pincode ? `<PARTYPINCODE>${escapeXml(partyDetails.pincode)}</PARTYPINCODE>` : ""}${partyDetails.state ? `<STATENAME>${escapeXml(partyDetails.state)}</STATENAME>` : ""}${partyDetails.country ? `<COUNTRYOFRESIDENCE>${escapeXml(partyDetails.country)}</COUNTRYOFRESIDENCE>` : ""}${partyDetails.gstin ? `<PARTYGSTIN>${escapeXml(partyDetails.gstin)}</PARTYGSTIN>` : ""}${partyDetails.gst_registration_type ? `<GSTREGISTRATIONTYPE>${escapeXml(partyDetails.gst_registration_type)}</GSTREGISTRATIONTYPE><VATDEALERTYPE>${escapeXml(partyDetails.gst_registration_type)}</VATDEALERTYPE>` : ""}<ADDRESS.LIST TYPE="String">${addressLines}</ADDRESS.LIST>`;
  const consigneeXml = consignee.name ? `<CONSIGNEEMAILINGNAME>${escapeXml(consignee.name)}</CONSIGNEEMAILINGNAME>${consignee.pincode ? `<CONSIGNEEPINCODE>${escapeXml(consignee.pincode)}</CONSIGNEEPINCODE>` : ""}${consignee.state ? `<CONSIGNEESTATENAME>${escapeXml(consignee.state)}</CONSIGNEESTATENAME>` : ""}${consignee.country ? `<CONSIGNEECOUNTRYNAME>${escapeXml(consignee.country)}</CONSIGNEECOUNTRYNAME>` : ""}` : "";
  const companyRegistration = companyDetails.gst_registration
    ? `<GSTREGISTRATION TAXTYPE="GST" TAXREGISTRATION="${escapeXml(companyDetails.gstin || "")}">${escapeXml(companyDetails.gst_registration)}</GSTREGISTRATION>`
    : "";
  const gstCompany = `${companyDetails.gstin ? `<CMPGSTIN>${escapeXml(companyDetails.gstin)}</CMPGSTIN>` : ""}${companyDetails.gst_registration_type ? `<CMPGSTREGISTRATIONTYPE>${escapeXml(companyDetails.gst_registration_type)}</CMPGSTREGISTRATIONTYPE>` : ""}${companyDetails.state ? `<CMPGSTSTATE>${escapeXml(companyDetails.state)}</CMPGSTSTATE>` : ""}`;
  const placeOfSupply = header.place_of_supply ? `<PLACEOFSUPPLY>${escapeXml(header.place_of_supply)}</PLACEOFSUPPLY>` : "";
  const customFields = buildUdfFields(header.custom_fields || order.custom_fields || {});
  const voucherView = isInvoice ? "Invoice Voucher View" : "Accounting Voucher View";
  const voucher = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create" OBJVIEW="${voucherView}"><DATE>${escapeXml(date)}</DATE><VCHSTATUSDATE>${escapeXml(date)}</VCHSTATUSDATE><VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${escapeXml(voucherNo)}</VOUCHERNUMBER><PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME>${partyDetails.gst_registration_type ? `<GSTREGISTRATIONTYPE>${escapeXml(partyDetails.gst_registration_type)}</GSTREGISTRATIONTYPE>` : ""}${companyDetails.state ? `<STATENAME>${escapeXml(companyDetails.state)}</STATENAME>` : ""}${partyDetails.country ? `<COUNTRYOFRESIDENCE>${escapeXml(partyDetails.country)}</COUNTRYOFRESIDENCE>` : ""}${placeOfSupply}${companyRegistration}${gstCompany}${mailing}<BASICBASEPARTYNAME>${escapeXml(partyDetails.mailing_name || party)}</BASICBASEPARTYNAME>${consigneeXml}<ISINVOICE>${isInvoice ? "Yes" : "No"}</ISINVOICE><PERSISTEDVIEW>${voucherView}</PERSISTEDVIEW><VCHENTRYMODE>${escapeXml(header.voucher_mode || (isInvoice ? "Item Invoice" : "Accounting Invoice"))}</VCHENTRYMODE><EFFECTIVEDATE>${escapeXml(date)}</EFFECTIVEDATE><DIFFACTUALQTY>No</DIFFACTUALQTY>${entries}${partyLedgerXml}${customFields}</VOUCHER></TALLYMESSAGE>`;
  return buildImportEnvelope({ companyName: company, messages: [voucher] });
}

/** Builds an accounting Receipt Voucher from the Connector's canonical JSON shape. */
export function buildReceiptVoucherXml({ companyName, receipt = {} } = {}) {
  const header = receipt.header || receipt;
  const date = toTallyDate(header.date || header.voucher_date);
  const voucherType = header.voucher_type || "Receipt";
  const voucherNo = header.voucher_number || header.reference || "";
  const party = header.party?.ledger_name || header.party_ledger;
  const paymentLedger = header.payment?.ledger_name || header.payment_ledger;
  const amount = Math.abs(Number(header.amount));
  if (!party) throw new TypeError("Receipt voucher requires party.ledger_name.");
  if (!paymentLedger) throw new TypeError("Receipt voucher requires payment.ledger_name (Cash or Bank ledger).");
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError("Receipt voucher amount must be greater than zero.");

  const company = companyName || receipt.destination?.company || receipt.destination?.company_name;
  const billReference = header.bill_reference;
  const billType = header.bill_type || (billReference ? "Agst Ref" : "On Account");
  const billAllocation = billReference
    ? `<BILLALLOCATIONS.LIST><NAME>${escapeXml(billReference)}</NAME><BILLTYPE>${escapeXml(billType)}</BILLTYPE><AMOUNT>${amount}</AMOUNT></BILLALLOCATIONS.LIST>`
    : "";
  const partyEntry = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT>${billAllocation}</ALLLEDGERENTRIES.LIST>`;
  const paymentEntry = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(paymentLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>-${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const customFields = header.custom_fields || {};
  if (typeof customFields !== "object" || Array.isArray(customFields)) throw new TypeError("custom_fields must be a JSON object.");
  const customXml = Object.entries(customFields).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || value === null || typeof value === "object") {
      throw new TypeError(`Unsupported custom field '${name}'. Use a Tally UDF field name and a scalar value.`);
    }
    return `<UDF:${name}>${escapeXml(value)}</UDF:${name}>`;
  }).join("");
  const voucher = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE><VCHSTATUSDATE>${date}</VCHSTATUSDATE><VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${escapeXml(voucherNo)}</VOUCHERNUMBER><PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME><ISINVOICE>No</ISINVOICE><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><EFFECTIVEDATE>${date}</EFFECTIVEDATE>${paymentEntry}${partyEntry}${customXml}</VOUCHER></TALLYMESSAGE>`;
  return buildImportEnvelope({ companyName: company, messages: [voucher] });
}

/** Builds a Purchase Order inventory voucher from the canonical purchase shape. */
export function buildPurchaseOrderXml({ companyName, order = {} } = {}) {
  return buildPurchaseInventoryVoucherXml({ companyName, data: order, defaultType: "Purchase Order", includeAccounting: false });
}

/** Builds a Purchase invoice voucher from the canonical purchase shape. */
export function buildPurchaseVoucherXml({ companyName, purchase = {} } = {}) {
  return buildPurchaseInventoryVoucherXml({ companyName, data: purchase, defaultType: "Purchase", includeAccounting: true });
}

function buildPurchaseInventoryVoucherXml({ companyName, data, defaultType, includeAccounting }) {
  const header = data.header || data;
  const items = header.items || header.line_items || header.lineItems;
  if (!Array.isArray(items) || !items.length) throw new TypeError(`${defaultType} must include a non-empty items array.`);
  const date = toTallyDate(header.date || header.voucher_date || header.order_date);
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger || header.supplier_name || header.party_ledger_entry?.ledger;
  if (!party) throw new TypeError(`${defaultType} requires party.ledger_name or supplier_ledger.`);
  const voucherType = header.voucher_type || defaultType;
  const voucherNo = header.voucher_number || header.reference || "";
  const orderNo = header.order_number || header.purchase_order_number || "";
  const supplierInvoiceNo = header.supplier_invoice_number || header.supplier_invoice_no || (includeAccounting ? header.reference : "");
  const supplierInvoiceDate = header.supplier_invoice_date || header.supplier_invoice_date_of_invoice;
  const supplierInvoiceDateXml = includeAccounting && supplierInvoiceDate ? toTallyDate(supplierInvoiceDate) : "";
  const company = companyName || data.destination?.company || data.destination?.company_name || header.company?.name;
  const entries = items.map((item) => {
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
    const accounting = includeAccounting && purchaseLedger
      ? `<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${escapeXml(purchaseLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${signedAmount}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>` : "";
    const batch = item.batch || {};
    const batchName = batch.name || item.batch_name;
    const godownName = batch.godown || item.godown;
    const batchXml = batchName || godownName
      ? `<BATCHALLOCATIONS.LIST>${batch.manufactured_on ? `<MFDON>${toTallyDate(batch.manufactured_on)}</MFDON>` : ""}${godownName ? `<GODOWNNAME>${escapeXml(godownName)}</GODOWNNAME>` : ""}${batchName ? `<BATCHNAME>${escapeXml(batchName)}</BATCHNAME>` : ""}${godownName ? `<DESTINATIONGODOWNNAME>${escapeXml(godownName)}</DESTINATIONGODOWNNAME>` : ""}<AMOUNT>-${signedAmount}</AMOUNT><ACTUALQTY> ${quantity}${unit ? ` ${escapeXml(unit)}` : ""}</ACTUALQTY><BILLEDQTY> ${quantity}${unit ? ` ${escapeXml(unit)}` : ""}</BILLEDQTY>${batch.expiry_date ? `<EXPIRYPERIOD>${escapeXml(batch.expiry_date)}</EXPIRYPERIOD>` : ""}</BATCHALLOCATIONS.LIST>` : "";
    const itemOrderNo = item.order_number || item.purchase_order_number || orderNo;
    return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${escapeXml(name)}</STOCKITEMNAME>${itemOrderNo ? `<ORDERNO>${escapeXml(itemOrderNo)}</ORDERNO>` : ""}<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE><RATE>${rate}${unit ? `/${escapeXml(unit)}` : ""}</RATE><AMOUNT>-${signedAmount}</AMOUNT><ACTUALQTY> ${quantity}${unit ? ` ${escapeXml(unit)}` : ""}</ACTUALQTY><BILLEDQTY> ${quantity}${unit ? ` ${escapeXml(unit)}` : ""}</BILLEDQTY>${batchXml}${accounting}</ALLINVENTORYENTRIES.LIST>`;
  }).join("");
  const total = Math.abs(Number(header.total_amount ?? items.reduce((sum, item) => sum + Math.abs(Number(item.amount ?? Number(item.quantity ?? item.qty) * Number(item.rate ?? item.unit_rate))), 0)));
  if (!Number.isFinite(total) || total <= 0) throw new TypeError(`${defaultType} total_amount must be greater than zero.`);
  const partyEntry = header.party_ledger_entry || {};
  const billReference = partyEntry.bill_reference || header.bill_reference || voucherNo;
  const billType = partyEntry.bill_type || header.bill_type || "New Ref";
  const partyAmount = Math.abs(Number(partyEntry.amount ?? total));
  const partyXml = `<LEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(partyEntry.ledger || party)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><AMOUNT>${partyAmount}</AMOUNT>${includeAccounting && billReference ? `<BILLALLOCATIONS.LIST><NAME>${escapeXml(billReference)}</NAME><BILLTYPE>${escapeXml(billType)}</BILLTYPE><AMOUNT>${partyAmount}</AMOUNT></BILLALLOCATIONS.LIST>` : ""}</LEDGERENTRIES.LIST>`;
  const customFields = header.custom_fields || data.custom_fields || {};
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) throw new TypeError("custom_fields must be a JSON object.");
  const customXml = Object.entries(customFields).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || value === null || typeof value === "object") throw new TypeError(`Unsupported custom field '${name}'. Use a Tally UDF field name and scalar value.`);
    return `<UDF:${name}>${escapeXml(value)}</UDF:${name}>`;
  }).join("");
  const view = "Invoice Voucher View";
  const voucher = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create" OBJVIEW="${view}"><DATE>${date}</DATE><VCHSTATUSDATE>${date}</VCHSTATUSDATE><VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME>${voucherNo ? `<VOUCHERNUMBER>${escapeXml(voucherNo)}</VOUCHERNUMBER>` : ""}${orderNo ? `<ORDERNO>${escapeXml(orderNo)}</ORDERNO>` : ""}${supplierInvoiceNo ? `<REFERENCE>${escapeXml(supplierInvoiceNo)}</REFERENCE>` : ""}${supplierInvoiceDateXml ? `<REFERENCEDATE>${supplierInvoiceDateXml}</REFERENCEDATE>` : ""}<PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME><ISINVOICE>${includeAccounting ? "Yes" : "No"}</ISINVOICE><PERSISTEDVIEW>${view}</PERSISTEDVIEW><VCHENTRYMODE>${escapeXml(header.voucher_mode || "Item Invoice")}</VCHENTRYMODE><EFFECTIVEDATE>${date}</EFFECTIVEDATE><DIFFACTUALQTY>No</DIFFACTUALQTY>${entries}${partyXml}${customXml}</VOUCHER></TALLYMESSAGE>`;
  return buildImportEnvelope({ companyName: company, messages: [voucher] });
}

/** Builds an accounting Payment Voucher, reversing the Receipt ledger directions. */
export function buildPaymentVoucherXml({ companyName, payment = {} } = {}) {
  const header = payment.header || payment;
  const date = toTallyDate(header.date || header.voucher_date);
  const voucherType = header.voucher_type || "Payment";
  const voucherNo = header.voucher_number || header.reference || "";
  const party = header.party?.ledger_name || header.party_ledger || header.supplier_ledger;
  const paymentLedger = header.payment?.ledger_name || header.payment_ledger;
  const amount = Math.abs(Number(header.amount));
  if (!party) throw new TypeError("Payment voucher requires party.ledger_name (supplier ledger).");
  if (!paymentLedger) throw new TypeError("Payment voucher requires payment.ledger_name (Cash or Bank ledger).");
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError("Payment voucher amount must be greater than zero.");
  const company = companyName || payment.destination?.company || payment.destination?.company_name;
  const billReference = header.bill_reference;
  const billType = header.bill_type || (billReference ? "Agst Ref" : "On Account");
  const billAllocation = billReference ? `<BILLALLOCATIONS.LIST><NAME>${escapeXml(billReference)}</NAME><BILLTYPE>${escapeXml(billType)}</BILLTYPE><AMOUNT>-${amount}</AMOUNT></BILLALLOCATIONS.LIST>` : "";
  const partyEntry = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>-${amount}</AMOUNT>${billAllocation}</ALLLEDGERENTRIES.LIST>`;
  const paymentEntry = `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${escapeXml(paymentLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const customFields = header.custom_fields || {};
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) throw new TypeError("custom_fields must be a JSON object.");
  const customXml = Object.entries(customFields).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || value === null || typeof value === "object") throw new TypeError(`Unsupported custom field '${name}'. Use a Tally UDF field name and scalar value.`);
    return `<UDF:${name}>${escapeXml(value)}</UDF:${name}>`;
  }).join("");
  const voucher = `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${escapeXml(voucherType)}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${date}</DATE><VCHSTATUSDATE>${date}</VCHSTATUSDATE><VOUCHERTYPENAME>${escapeXml(voucherType)}</VOUCHERTYPENAME><VOUCHERNUMBER>${escapeXml(voucherNo)}</VOUCHERNUMBER><PARTYLEDGERNAME>${escapeXml(party)}</PARTYLEDGERNAME><ISINVOICE>No</ISINVOICE><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW><EFFECTIVEDATE>${date}</EFFECTIVEDATE>${partyEntry}${paymentEntry}${customXml}</VOUCHER></TALLYMESSAGE>`;
  return buildImportEnvelope({ companyName: company, messages: [voucher] });
}

/** Decodes XML entities in a captured text value. */
function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** Extracts and decodes the first matching element's text from an XML string. */
function tagValue(xml, tag) {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)</${safeTag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]*>/g, "").trim()) : "";
}

/**
 * Reads company names and GUIDs from a Tally company-list response.
 *
 * @param {string} xml Raw Tally XML response.
 * @returns {Array<{name: string, guid: string}>} Unique named companies.
 */
export function parseCompanyList(xml) {
  const companies = [];
  const pattern = /<COMPANY\b[^>]*>([\s\S]*?)<\/COMPANY>/gi;
  for (const match of String(xml || "").matchAll(pattern)) {
    const name = tagValue(match[1], "NAME");
    if (name && !companies.some((company) => company.name === name)) {
      companies.push({ name, guid: tagValue(match[1], "GUID") });
    }
  }
  return companies;
}

/**
 * Parses common Tally Import Data summary fields and voucher-level errors.
 *
 * @param {string} xml Raw Tally XML response.
 * @returns {{ok: boolean, summary: object, raw: string}} Summary flags, totals, errors, and original XML.
 */
export function parseImportResponse(xml) {
  const value = (tag) => Number(tagValue(xml, tag) || 0);
  const lineErrors = [...String(xml || "").matchAll(/<LINEERROR\b[^>]*>([\s\S]*?)<\/LINEERROR>/gi)]
    .map((match) => decodeXml(match[1].replace(/<[^>]*>/g, "").trim()))
    .filter(Boolean);
  const summary = {
    created: value("CREATED"),
    altered: value("ALTERED"),
    deleted: value("DELETED"),
    errors: value("ERRORS"),
    ignored: value("IGNORED"),
    cancelled: value("CANCELLED"),
    tallyStatus: tagValue(xml, "STATUS"),
    voucherNumber: tagValue(xml, "VCHNUMBER"),
    lineErrors,
    lastVoucherId: tagValue(xml, "LASTVCHID"),
    lastMasterId: tagValue(xml, "LASTMID"),
  };
  // Tally can return a syntactically valid import summary with zero errors
  // while creating or altering nothing. Do not report that as a successful
  // voucher push; callers must treat a no-op import as a failed transaction.
  const changedRecords = summary.created + summary.altered;
  return {
    ok: summary.errors === 0 && lineErrors.length === 0 && changedRecords > 0,
    summary,
    raw: String(xml || ""),
  };
}
