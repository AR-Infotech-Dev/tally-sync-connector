import { mapPurchaseOrderToTemplate } from "./purchase-order.mapper.js";
import { renderXmlTemplate } from "../../../shared/template/templateRenderer.js";
import { buildImportEnvelope } from "../../../shared/utils/xmlHelpers.js";

/** Public entry: validate/map input, render the voucher, then wrap it for Tally import. */
export function buildPurchaseOrderXml(input = {}) {
  const { companyName, template, context } = mapPurchaseOrderToTemplate(input);
  const voucherXml = renderXmlTemplate(template, context);
  return buildImportEnvelope({ companyName, messages: [voucherXml] });
}
