import { records, children, field, nameOf } from "./statement.js";
import { buildCollectionRequest } from "../../shared/requests/xml.js";

export function buildCacheStockItemsRequest(company, ids) {
  return buildCollectionRequest({
    collectionName: "Flowups Cache Stock Items",
    objectType: "StockItem",
    fetchFields: ["Name", "GUID", "MasterID", "MailingName"],
    companyName: company,
    masterIds: ids,
  });
}

export function parseCacheStockItems(xml) {
  const rows = records(xml, "STOCKITEM")
    .map((node) => {
      const name = node.getAttribute("NAME") || field(node, "NAME");
      if (!name) throw new Error("Tally returned a stock item without its name.");
      // Tally Part No. is MailingName, not the stock item's NAME.LIST aliases.
      const part_numbers = children(node)
        .filter((child) => nameOf(child) === "MAILINGNAME.LIST")
        .flatMap((list) =>
          children(list)
            .filter((child) => nameOf(child) === "MAILINGNAME")
            .map((child) => child.textContent.trim()),
        )
        .filter(Boolean);
      const scalar = field(node, "MAILINGNAME");
      if (scalar) part_numbers.push(scalar);
      return {
        name,
        part_numbers: [...new Set(part_numbers)],
        master_id: field(node, "MASTERID"),
        guid: field(node, "GUID"),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  if (new Set(rows.map((row) => row.name)).size !== rows.length)
    throw new Error("Tally returned duplicate stock item names during sync.");
  return rows;
}
