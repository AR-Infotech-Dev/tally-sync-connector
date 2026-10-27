import { escapeXml } from "../utils/xmlHelpers.js";

/** Validates scalar Tally UDF values and escapes their XML content. */
export function mapUdfFields(customFields = {}, scalarError = "Use a Tally UDF field name and a scalar value.") {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) throw new TypeError("custom_fields must be a JSON object.");
  return Object.entries(customFields).map(([name, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/.test(name) || value === null || typeof value === "object") {
      throw new TypeError(`Unsupported custom field '${name}'. ${scalarError}`);
    }
    return { name, value: escapeXml(value) };
  });
}
