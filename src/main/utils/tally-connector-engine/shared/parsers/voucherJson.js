import { DOMParser } from "@xmldom/xmldom";

const fieldName = (name) =>
  name
    .replace(/\.LIST$/i, "")
    .replaceAll(":", "_")
    .toLowerCase();
const setField = (object, key, value) =>
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });

function elementToJson(element, depth = 0) {
  if (depth > 100) throw new Error("Tally voucher nesting exceeds the supported limit.");
  const result = {};
  const attributes = {};
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    setField(attributes, attribute.name, attribute.value);
  }
  if (Object.keys(attributes).length) result._attributes = attributes;
  const groups = new Map();
  let text = "";
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const key = fieldName(child.nodeName);
      if (!groups.has(key)) groups.set(key, { list: /\.LIST$/i.test(child.nodeName), values: [] });
      const group = groups.get(key);
      group.list ||= /\.LIST$/i.test(child.nodeName);
      group.values.push(elementToJson(child, depth + 1));
    } else if (child.nodeType === 3 || child.nodeType === 4) text += child.nodeValue;
  }
  // Keep numeric-looking values as strings: voucher numbers, decimal precision,
  // leading zeros and quantities with units must not be silently changed.
  if (!groups.size && !Object.keys(attributes).length) return text.trim();
  for (const [key, group] of groups)
    setField(result, key, group.list || group.values.length > 1 ? group.values : group.values[0]);
  if (text.trim()) result._text = text.trim();
  return result;
}

export function parseTallyDocument(xml) {
  // Tally can include internal separators such as &#4; in exported names.
  // These are forbidden XML 1.0 characters, not ledger text or amounts.
  const legalCodePoint = (code) =>
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 32 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff);
  const text = String(xml || "")
    .replace(/^\uFEFF/, "")
    // Some Tally exports emit custom fields without the UDF declaration, or
    // explicitly bind that known prefix to an empty URI.
    .replace(/\bxmlns:UDF\s*=\s*(["'])\s*\1/g, 'xmlns:UDF="TallyUDF"')
    .replace(/&#(?:x([\da-f]+)|(\d+));/gi, (match, hex, decimal) =>
      legalCodePoint(parseInt(hex || decimal, hex ? 16 : 10)) ? match : "",
    )
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error("Tally voucher XML declarations are not supported.");
  let document;
  let detail = "invalid XML structure";
  try {
    document = new DOMParser({
      xmlns: { UDF: "TallyUDF" },
      onError: (level, message, context) => {
        // U+FFFD is legal XML text. xmldom warns about its presence in legacy
        // Tally master names; keep the character exactly as exported instead of
        // rejecting a complete snapshot or silently changing an item's identity.
        if (
          level === "warning" &&
          message === "Unicode replacement character detected, source encoding issues?"
        )
          return;
        const reason = /entity/i.test(message)
          ? "invalid XML entity"
          : /namespace|prefix/i.test(message)
            ? "invalid XML namespace"
            : /attribute/i.test(message)
              ? "invalid XML attribute"
              : /tag|element/i.test(message)
                ? "mismatched or incomplete XML tags"
                : "invalid XML structure";
        const locator = context?.locator;
        detail = `${reason}${locator?.lineNumber ? ` at line ${locator.lineNumber}, column ${locator.columnNumber || 1}` : ""}`;
        throw new Error("Invalid XML");
      },
    }).parseFromString(text, "text/xml");
  } catch {
    throw new Error(`Tally returned malformed voucher XML: ${detail}.`);
  }
  return document;
}

export function parseVoucherJson(xml) {
  const document = parseTallyDocument(xml);
  const elements = Array.from(document.getElementsByTagName("*"));
  const tagName = (element) =>
    (element.localName || element.nodeName.split(":").at(-1)).toUpperCase();
  if (elements.some((element) => ["LINEERROR", "ERRORMSG", "ERROR"].includes(tagName(element)))) {
    throw new Error("Tally returned a voucher export error.");
  }
  // CMPINFO contains a scalar VOUCHER count alongside the actual BODY/DATA
  // voucher. Exclude envelope metadata and nested references from record selection.
  const vouchers = elements.filter((element) => {
    if (tagName(element) !== "VOUCHER") return false;
    for (let parent = element.parentNode; parent?.nodeType === 1; parent = parent.parentNode) {
      if (["VOUCHER", "HEADER", "DESC", "CMPINFO"].includes(tagName(parent))) return false;
    }
    return true;
  });
  if (vouchers.length !== 1) {
    const shape = [...new Set(elements.map(tagName))].slice(0, 20).join(", ");
    throw new Error(
      `Tally returned ${vouchers.length} voucher records; expected one. Response tags: ${shape || "none"}.`,
    );
  }
  return elementToJson(vouchers[0]);
}
