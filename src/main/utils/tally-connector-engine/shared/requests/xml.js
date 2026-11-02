import { escapeXml } from "../utils/xmlHelpers.js";

export function buildCollectionRequest({
  collectionName,
  objectType,
  fetchFields = [],
  companyName,
} = {}) {
  if (!collectionName || !objectType || !Array.isArray(fetchFields) || fetchFields.length === 0) {
    throw new TypeError("collectionName, objectType, and at least one fetchField are required.");
  }
  const name = escapeXml(collectionName);
  const company = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : "";
  const fields = escapeXml(fetchFields.join(","));
  return [
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>",
    `<ID>${name}</ID></HEADER><BODY><DESC><STATICVARIABLES>${company}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>`,
    `<TDL><TDLMESSAGE><COLLECTION NAME=\"${name}\" ISMODIFY=\"No\"><TYPE>${escapeXml(objectType)}</TYPE><FETCH>${fields}</FETCH></COLLECTION></TDLMESSAGE></TDL>`,
    "</DESC></BODY></ENVELOPE>",
  ].join("");
}

export function buildVoucherLookupRequest({ companyName, voucherId } = {}) {
  if (!companyName || !String(companyName).trim())
    throw new TypeError("A Tally company name is required to read a voucher.");
  if (!/^\d+$/.test(String(voucherId ?? "")))
    throw new TypeError("A numeric Tally voucher ID is required to read a voucher.");
  return [
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE>",
    `<ID TYPE="Name">ID:${escapeXml(voucherId)}</ID></HEADER>`,
    "<BODY><DESC><STATICVARIABLES>",
    `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVViewName>Accounting Voucher View</SVViewName>`,
    "</STATICVARIABLES><FETCHLIST><FETCH>VoucherNumber</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>",
  ].join("");
}

export function buildLedgerMasterImport({ companyName, ledgers = [] } = {}) {
  if (!Array.isArray(ledgers) || ledgers.length === 0) {
    throw new TypeError("At least one ledger master is required.");
  }
  const messages = ledgers
    .map(({ name, parent, billWise = false, dealer_code = "" }) => {
      if (!name || !parent)
        throw new TypeError("Each ledger master requires a name and Tally parent group.");
      return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER Action="Create"><NAME>${escapeXml(name)}</NAME><PARENT>${escapeXml(parent)}</PARENT>${billWise ? "<ISBILLWISEON>Yes</ISBILLWISEON>" : ""}${dealer_code ? `<NARRATION>${escapeXml(dealer_code)}</NARRATION>` : ""}</LEDGER></TALLYMESSAGE>`;
    })
    .join("");
  const company = companyName
    ? `<SVCURRENTCOMPANY>${escapeXml(companyName)}</SVCURRENTCOMPANY>`
    : "";
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${company}</STATICVARIABLES></REQUESTDESC><REQUESTDATA>${messages}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
