import {decodeXml,tagValue} from "./xmlParser.js";

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
    exceptions: value("EXCEPTIONS"),
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
    ok: summary.errors === 0 && summary.exceptions === 0 && lineErrors.length === 0 && changedRecords > 0,
    summary,
    raw: String(xml || ""),
  };
}
