import { escapeXml } from "../../../shared/utils/xmlHelpers.js";

export function buildSalesVoucherSearchRequest({ company, ledger_name, voucher_no, voucher_date } = {}, { salesOrder = false } = {}) {
  for (const value of [company, ledger_name, voucher_no]) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError("Company, ledger name and voucher number are required.");
  }
  const date = voucher_date?.replaceAll("-", "");
  if (date && !/^\d{8}$/.test(date)) throw new TypeError("Invalid voucher date.");
  return [
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Flowups Sales PDF Lookup</ID></HEADER><BODY><DESC><STATICVARIABLES>',
    `<SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>`,
    `<SVFROMDATE TYPE="Date">${date || "19000101"}</SVFROMDATE><SVTODATE TYPE="Date">${date || "20991231"}</SVTODATE>`,
    `<FlowupsPdfLedger TYPE="String">${escapeXml(ledger_name)}</FlowupsPdfLedger><FlowupsPdfNumber TYPE="String">${escapeXml(voucher_no)}</FlowupsPdfNumber>`,
    '</STATICVARIABLES><TDL><TDLMESSAGE>',
    '<VARIABLE NAME="FlowupsPdfLedger"><TYPE>String</TYPE></VARIABLE><VARIABLE NAME="FlowupsPdfNumber"><TYPE>String</TYPE></VARIABLE>',
    '<COLLECTION NAME="Flowups Sales PDF Lookup"><TYPE>Voucher</TYPE><FETCH>MasterID,VoucherNumber,PartyLedgerName,Date,VoucherTypeName</FETCH><FILTER>Flowups Sales PDF Match</FILTER></COLLECTION>',
    `<SYSTEM TYPE="Formulae" NAME="Flowups Sales PDF Match">${salesOrder ? "$$IsSalesOrder" : "$$IsSales"}:$VoucherTypeName AND $PartyLedgerName = ##FlowupsPdfLedger AND $VoucherNumber = ##FlowupsPdfNumber AND NOT $IsCancelled AND NOT $IsOptional</SYSTEM>`,
    '</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>',
  ].join("");
}

export function parseSalesVoucherSearchResponse(xml) {
  const text = String(xml || "");
  if (/<(?:LINEERROR|ERRORMSG|ERROR)\b/i.test(text) || /<STATUS>\s*0\s*<\/STATUS>/i.test(text)) {
    throw new Error("Tally rejected the Sales Voucher lookup. Confirm the company is open in Tally.");
  }
  if (!/<COLLECTION\b/i.test(text)) throw new Error("Tally did not return a voucher collection for the PDF lookup.");
  const ids = [...text.matchAll(/<MASTERID\b[^>]*>\s*(\d+)\s*<\/MASTERID>/gi)].map((match) => match[1]).filter((id) => Number(id) > 0);
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) throw new Error("No Sales Voucher found in Tally for this company, ledger_name and voucher_no. Check the exact values and optional voucher_date.");
  if (uniqueIds.length > 1) throw new Error("Multiple Sales Vouchers found in Tally. Supply voucher_date (YYYY-MM-DD) to select the correct voucher.");
  return uniqueIds[0];
}
