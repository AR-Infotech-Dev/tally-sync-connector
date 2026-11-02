import { escapeXml } from "../../../shared/utils/xmlHelpers.js";
import { parseVoucherJson } from "../../../shared/parsers/voucherJson.js";
import { buildSalesVoucherSearchRequest } from "../sales/sales.lookup.js";

export const buildSalesOrderSearchRequest = (lookup) =>
  buildSalesVoucherSearchRequest(lookup, { salesOrder: true });

export function parseSalesOrderSearchResponse(xml, label = "Sales Order") {
  const text = String(xml || "");
  if (
    /<(?:LINEERROR|ERRORMSG|ERROR)\b/i.test(text) ||
    /<STATUS>\s*0\s*<\/STATUS>/i.test(text) ||
    !/<COLLECTION\b/i.test(text)
  ) {
    throw new Error(
      `Tally rejected the ${label} lookup or returned no collection. Confirm the company is open.`,
    );
  }
  const ids = [
    ...new Set(
      [...text.matchAll(/<MASTERID\b[^>]*>\s*(\d+)\s*<\/MASTERID>/gi)]
        .map((match) => match[1])
        .filter((id) => Number(id) > 0),
    ),
  ];
  if (ids.length !== 1) {
    const error = new Error(
      ids.length
        ? `Multiple ${label} vouchers match. Supply voucher_date (YYYY-MM-DD).`
        : `${label} not found in Tally for the supplied company, ledger_name and voucher_no.`,
    );
    error.httpStatus = ids.length ? 409 : 404;
    throw error;
  }
  return ids[0];
}

export function buildSalesOrderObjectRequest(company, voucherId) {
  if (!/^\d+$/.test(String(voucherId))) throw new TypeError("Invalid Tally voucher ID.");
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:${escapeXml(voucherId)}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVViewName>Accounting Voucher View</SVViewName></STATICVARIABLES><FETCHLIST><FETCH>*</FETCH><FETCH>ALLINVENTORYENTRIES.*</FETCH><FETCH>ALLLEDGERENTRIES.*</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>`;
}

export function parseSalesOrderObjectResponse(xml, lookup, label = "Sales Order") {
  const text = String(xml || "");
  if (/<(?:LINEERROR|ERRORMSG|ERROR)\b/i.test(text))
    throw new Error(`Tally did not return the ${label} voucher data.`);
  return {
    company: lookup.company,
    ledger_name: lookup.ledger_name,
    voucher_no: lookup.voucher_no,
    details: parseVoucherJson(text),
  };
}
