import { tagValue } from "../../shared/parsers/xmlParser.js";

export function parseCompanyList(xml) {
  const companies = [];
  const pattern = /<COMPANY\b[^>]*>([\s\S]*?)<\/COMPANY>/gi;
  for (const match of String(xml || "").matchAll(pattern)) {
    const name = tagValue(match[1], "NAME");
    if (name && !companies.some((company) => company.name === name)) {
      companies.push({ name, guid: tagValue(match[1], "GUID") });
    }
  }
  return companies;
}
