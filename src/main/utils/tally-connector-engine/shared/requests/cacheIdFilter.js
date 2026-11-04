export function cacheIdFilter(ids) {
  if (ids === undefined) return { filter: "", formula: "" };
  if (!ids.length || ids.length > 100 || ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error("Invalid cache MasterID batch.");
  }
  return {
    filter: "<FILTER>FlowupsCacheIds</FILTER>",
    formula: `<SYSTEM TYPE="Formulae" NAME="FlowupsCacheIds">${ids.map((id) => `$MasterID = ${id}`).join(" OR ")}</SYSTEM>`,
  };
}
