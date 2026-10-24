export function parseVoucherNumber(xml) {
  const match = String(xml || "").match(/<VOUCHERNUMBER\b[^>]*>([\s\S]*?)<\/VOUCHERNUMBER>/i);
  return match ? match[1].replace(/<[^>]*>/g, "").trim() : "";
}
