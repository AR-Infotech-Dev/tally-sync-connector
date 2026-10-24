export function decodeXml(value) {
  return String(value || "")
    .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function tagValue(xml, tag) {
  const safeTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)</${safeTag}>`, "i"));
  return match ? decodeXml(match[1].replace(/<[^>]*>/g, "").trim()) : "";
}
