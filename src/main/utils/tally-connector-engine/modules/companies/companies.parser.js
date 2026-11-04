import { records, field } from "../ledgers/statement.js";
import { companyGuid, validateCompanyList } from "../../../companyIdentity.js";
import { discoveredCompany } from "../../../companyKey.js";

export function parseCompanyList(xml) {
  const companies = records(xml, "COMPANY").map((node) =>
    discoveredCompany({
      name: field(node, "NAME") || field(node, "FLOWUPSCOMPANYNAME") || node.getAttribute("NAME"),
      guid: companyGuid(field(node, "GUID")),
      company_number: field(node, "COMPANYNUMBER") || field(node, "FLOWUPSCOMPANYNUMBER"),
      data_path:
        field(node, "DATAPATH") ||
        field(node, "FLOWUPSCOMPANYPATH") ||
        field(node, "DIRECTORYNAME"),
    }),
  );
  return validateCompanyList(companies);
}
