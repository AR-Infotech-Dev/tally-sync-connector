import { companyNameKey } from "./companyName.js";

export function companyError(code, message, httpStatus = 409) {
  return Object.assign(new Error(message), { code, httpStatus });
}
export function companyGuid(value) {
  const guid = String(value || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(guid))
    throw companyError(
      "COMPANY_GUID_UNAVAILABLE",
      "Tally must return a valid company GUID. Company names cannot be used as IDs.",
    );
  return guid;
}
export function validateCompanyList(companies) {
  const unnamed = companies.findIndex((row) => !String(row.name || "").trim());
  if (unnamed >= 0)
    throw companyError(
      "COMPANY_DISCOVERY_INVALID",
      `Tally company record ${unnamed + 1} has no company name (Tally GUID: ${companies[unnamed].tally_guid || companies[unnamed].guid || "missing"}). Open that company in Tally and test again.`,
    );
  const byGuid = new Map();
  for (const row of companies) {
    const key = String(row.guid).trim().toLowerCase();
    if (!byGuid.has(key)) byGuid.set(key, []);
    byGuid.get(key).push(row.name);
  }
  const duplicate = [...byGuid].find(([_guid, names]) => names.length > 1);
  if (duplicate) {
    const [guid, names] = duplicate;
    const shown = [...new Set(names)]
      .slice(0, 5)
      .map((name) => JSON.stringify(name))
      .join(", ");
    throw companyError(
      "COMPANY_DISCOVERY_INVALID",
      `Tally returned the same company identity (${guid}) for ${names.length} open records: ${shown}. Distinct company folder information or explicit relinking is required. No company IDs have been changed.`,
    );
  }
  return companies;
}
export function openCompanyTarget(companies, reference) {
  const id = reference?.company_id;
  if (!id) throw companyError("COMPANY_ID_REQUIRED", "company_id is required.", 400);
  if (!reference.company_guid)
    throw companyError(
      "COMPANY_MAPPING_REQUIRED",
      "Server company mapping is missing. Update Server and refresh /companies.",
    );
  const expectedGuid = companyGuid(reference.company_guid);
  const matches = companies.filter((row) => {
    const guid = companyGuid(row.guid);
    return guid === expectedGuid;
  });
  if (!matches.length)
    throw companyError(
      "COMPANY_NOT_OPEN",
      "The requested company is not open in Tally. Open it and retry.",
    );
  if (matches.length !== 1)
    throw companyError("COMPANY_AMBIGUOUS", "Tally returned multiple companies for this identity.");
  const target = matches[0];
  if (
    companies.filter((row) => companyNameKey(row.name) === companyNameKey(target.name)).length !== 1
  )
    throw companyError(
      "COMPANY_AMBIGUOUS",
      "Multiple open Tally companies share this name. Close the other company before retrying.",
    );
  const guid = companyGuid(target.guid);
  if (
    reference.tally_guid &&
    reference.tally_guid.toLowerCase() !== (target.tally_guid || target.guid).toLowerCase()
  )
    throw companyError(
      "COMPANY_MAPPING_MISMATCH",
      "The requested Tally company does not match the Server mapping.",
    );
  return {
    company_id: id,
    company_guid: guid,
    tally_guid: target.tally_guid || target.guid,
    company: target.name,
  };
}
