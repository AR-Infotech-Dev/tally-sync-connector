import { renderXmlTemplate } from "../template/templateRenderer.js";
export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildImportEnvelope({ companyName, messages = [] } = {}) {
  if (!Array.isArray(messages) || messages.some((message) => typeof message !== "string" || !message.trim())) {
    throw new TypeError("messages must be an array of non-empty Tally XML strings.");
  }
  const company = companyName ? escapeXml(companyName) : "";
  return renderXmlTemplate("shared/XML/import-envelope.xml.hbs", { company, messages });
}

export function toTallyDate(value) {
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

export function mapOrderDueDate(value) {
  if (!value) throw new TypeError("Order item allocation requires order_due_date (YYYY-MM-DD). Supply it on the order or each item.");
  const date = toTallyDate(value);
  const year = Number(date.slice(0, 4)), month = Number(date.slice(4, 6)), day = Number(date.slice(6, 8));
  const display = `${day}-${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]}-${year}`;
  const julianDay = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 31)) / 86400000);
  return { julianDay, display };
}
