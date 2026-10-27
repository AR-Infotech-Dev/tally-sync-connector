import { mapSalesToTemplate } from "./sales.mapper.js";
import { renderXmlTemplate } from "../../../shared/template/templateRenderer.js";
import { buildImportEnvelope } from "../../../shared/utils/xmlHelpers.js";

/** Public entry: validate/map input, render the voucher, then wrap it for Tally import. */
export function buildSalesVoucherXml(input = {}) {
  const { companyName, template, context } = mapSalesToTemplate(input);
  const voucherXml = renderXmlTemplate(template, context);
  return buildImportEnvelope({ companyName, messages: [voucherXml] });
}
