import { escapeXml } from "./xml.js";

/**
 * Creates a Tally data-export request for the built-in Printed Invoice form.
 * Tally's LASTVCHID is used as the voucher object's stable internal identifier.
 * The requested file path is local to the computer running Tally/Connector.
 */
export function buildSalesInvoicePdfRequest({ companyName, voucherId, outputPath } = {}) {
  if (!companyName || !String(companyName).trim()) throw new TypeError("A Tally company name is required to export an invoice.");
  if (!/^\d+$/.test(String(voucherId ?? ""))) throw new TypeError("A numeric Tally voucher ID is required to export an invoice.");
  if (!outputPath || !String(outputPath).trim()) throw new TypeError("A local PDF output path is required.");

  const company = escapeXml(companyName);
  const path = escapeXml(String(outputPath).replaceAll("\\", "/"));
  const id = escapeXml(voucherId);
  return [
    "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Flowups PDF Export Controller</ID></HEADER>",
    "<BODY><DESC><STATICVARIABLES>",
    `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VoucherID>${id}</VoucherID>`,
    "</STATICVARIABLES><TDL><TDLMESSAGE>",
    '<REPORT NAME="Flowups PDF Export Controller" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No"><FORMS>Flowups PDF Export Controller Form</FORMS></REPORT>',
    '<FORM NAME="Flowups PDF Export Controller Form" ISMODIFY="No" ISFIXED="No" ISINITIALIZE="No" ISOPTION="No" ISINTERNAL="No"><TOPPARTS>Flowups PDF Export Controller Part</TOPPARTS><HEIGHT>100% Page</HEIGHT><WIDTH>100% Page</WIDTH></FORM>',
    '<PART NAME="Flowups PDF Export Controller Part"><TOPLINES>Flowups PDF Export Trigger Line</TOPLINES></PART>',
    '<LINE NAME="Flowups PDF Export Trigger Line"><FIELDS>Name Field</FIELDS></LINE>',
    '<FIELD NAME="Name Field"><SET>$$FlowupsExportSalesInvoicePDF</SET></FIELD>',
    '<FUNCTION NAME="FlowupsExportSalesInvoicePDF"><ACTION>01 : Set : SVExportFormat : $$SysName:PDF</ACTION><ACTION>02 : Set : SVExportFormatVar : $$SysName:PDF</ACTION>',
    `<ACTION>03 : Set : SVPrintFileName : "${path}"</ACTION>`,
    '<ACTION>04 : Set : SVOpenFileAfterExport : No</ACTION><ACTION>05 : Export Report : Flowups Standard Sales Invoice : True</ACTION><ACTION>06 : Return : "PDF export action completed"</ACTION></FUNCTION>',
    '<REPORT NAME="Flowups Standard Sales Invoice" ISMODIFY="No"><USE>Printed Invoice</USE><OBJECT>Voucher : $$Sprintf:"ID:%s":##VoucherID</OBJECT></REPORT>',
    "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>",
  ].join("");
}
