import { createHash } from "node:crypto";
import { escapeXml } from "./xml.js";
import { records, field, children, nameOf, yes, cents } from "./ledgerStatement.js";

const TO = "20991231";
function collection(company, name, body, fromDate) {
  const period = fromDate ? `<SVFROMDATE TYPE="Date">${fromDate}</SVFROMDATE><SVTODATE TYPE="Date">${TO}</SVTODATE>` : "";
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${name}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(company)}</SVCURRENTCOMPANY>${period}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE>${body}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}
function requireBooksDate(fromDate) {
  if (!/^\d{8}$/.test(fromDate || "")) throw new Error("Company BooksFrom/StartingFrom date is required for full-history sync.");
  return fromDate;
}

export function buildCacheCompaniesRequest() {
  return collection("", "Flowups Cache Companies", '<COLLECTION NAME="Flowups Cache Companies"><TYPE>Company</TYPE><FETCH>Name,GUID,BooksFrom,StartingFrom</FETCH></COLLECTION>');
}
export function parseCacheCompanies(xml) {
  return records(xml, "COMPANY").map((node) => {
    const name = field(node, "NAME") || node.getAttribute("NAME");
    const guid = field(node, "GUID");
    if (!name || !guid) throw new Error("Tally company export must include Name and GUID for cache isolation.");
    const booksFrom = field(node, "BOOKSFROM") || field(node, "STARTINGFROM");
    return { name, guid, books_from: requireBooksDate(booksFrom) };
  });
}

export function buildCacheLedgersRequest(company, fromDate) {
  return collection(company, "Flowups Cache Ledgers", '<COLLECTION NAME="Flowups Cache Ledgers"><TYPE>Ledger</TYPE><FETCH>Name,MasterID,GUID,AlterID,OpeningBalance</FETCH><COMPUTE>FlowupsOpeningAmount : $$AsPositive:$OpeningBalance</COMPUTE><COMPUTE>FlowupsOpeningDr : $$IsDr:$OpeningBalance</COMPUTE></COLLECTION>', requireBooksDate(fromDate));
}
export function parseCacheLedgers(xml) {
  return records(xml, "LEDGER").map((node) => {
    const name = field(node, "NAME") || node.getAttribute("NAME");
    const direction = field(node, "FLOWUPSOPENINGDR");
    const amount = field(node, "FLOWUPSOPENINGAMOUNT");
    if (!name || !amount || !/^(yes|no|true|false|0|1)$/i.test(direction)) throw new Error("Tally returned an incomplete ledger master for local sync.");
    return { name, master_id: field(node, "MASTERID"), guid: field(node, "GUID"), opening_cents: cents(amount) * (yes(direction) ? 1 : -1) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCacheManifestRequest(company, fromDate) {
  return collection(company, "Flowups Cache Manifest", '<COLLECTION NAME="Flowups Cache Manifest"><TYPE>Voucher</TYPE><FETCH>MasterID,AlterID,GUID,Date,VoucherNumber,VoucherTypeName,IsCancelled,IsOptional</FETCH></COLLECTION>', requireBooksDate(fromDate));
}
export const manifestKey = (rows) => JSON.stringify([...rows].sort((a, b) => Number(a.id) - Number(b.id)));
export function parseCacheManifest(xml) {
  const rows = records(xml, "VOUCHER").map((node) => {
    const id = field(node, "MASTERID");
    const alter = field(node, "ALTERID");
    if (!/^\d+$/.test(id) || Number(id) < 1 || !/^\d+$/.test(alter)) throw new Error("Tally must return MasterID and AlterID for incremental ledger sync.");
    const signature = createHash("sha256").update(JSON.stringify([alter, field(node, "GUID"), field(node, "DATE"), field(node, "VOUCHERNUMBER"), field(node, "VOUCHERTYPENAME"), field(node, "ISCANCELLED"), field(node, "ISOPTIONAL")])).digest("hex");
    return { id, alter_id: alter, signature };
  });
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error("Tally returned duplicate IDs in the sync manifest.");
  return rows;
}

export function buildCacheVoucherBatchRequest(company, ids, fromDate) {
  if (!ids.length || ids.length > 25 || ids.some((id) => !/^\d+$/.test(id))) throw new Error("Invalid voucher sync batch.");
  return collection(company, "Flowups Cache Voucher Batch", `<COLLECTION NAME="Flowups Cache Voucher Batch"><TYPE>Voucher</TYPE><FETCH>MasterID,AlterID,GUID,Date,VoucherNumber,VoucherTypeName,Narration,IsCancelled,IsOptional,IsOrderVoucher,AllLedgerEntries.*,LedgerEntries.*</FETCH><COMPUTE>FlowupsNonPosting : $$IsSalesOrder:$VoucherTypeName OR $$IsPurcOrder:$VoucherTypeName OR $$IsDelNote:$VoucherTypeName OR $$IsRcptNote:$VoucherTypeName OR $$IsStockJournal:$VoucherTypeName OR $$IsPhyStock:$VoucherTypeName</COMPUTE><FILTER>FlowupsCacheIds</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="FlowupsCacheIds">${ids.map((id) => `$MasterID = ${id}`).join(" OR ")}</SYSTEM>`, requireBooksDate(fromDate));
}

export function buildCacheVoucherTypesRequest(company) {
  return collection(company, "Flowups Cache Voucher Types", '<COLLECTION NAME="Flowups Cache Voucher Types"><TYPE>VoucherType</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>');
}
export function parseCacheVoucherTypes(xml) {
  const parents = new Map(records(xml, "VOUCHERTYPE").map((node) => [node.getAttribute("NAME") || field(node, "NAME"), field(node, "PARENT")]));
  const roots = new Set(["sales order", "purchase order", "delivery note", "receipt note", "stock journal", "physical stock", "material in", "material out", "job work in order", "job work out order", "memorandum", "reversing journal"]);
  return new Set([...parents.keys()].filter((name) => {
    const visited = new Set();
    while (name && !visited.has(name)) {
      if (roots.has(name.toLowerCase())) return true;
      visited.add(name); name = parents.get(name);
    }
    return false;
  }));
}
export function parseCacheVoucherBatch(xml, manifest, nonPostingTypes = new Set()) {
  const expected = new Map(manifest.map((row) => [row.id, row]));
  const vouchers = records(xml, "VOUCHER").map((node) => {
    const id = field(node, "MASTERID");
    const expectedRow = expected.get(id);
    if (!expectedRow || field(node, "ALTERID") !== expectedRow.alter_id) throw new Error("Tally changed while syncing; the previous local snapshot has been preserved.");
    const date = field(node, "DATE");
    if (!/^\d{8}$/.test(date)) throw new Error("Tally returned an invalid voucher date during sync.");
    const result = { ...expectedRow, date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, voucher_no: field(node, "VOUCHERNUMBER"), voucher_type: field(node, "VOUCHERTYPENAME"), narration: field(node, "NARRATION"), entries: [] };
    if (nonPostingTypes.has(result.voucher_type)) return result;
    if (["ISCANCELLED", "ISOPTIONAL", "ISORDERVOUCHER", "FLOWUPSNONPOSTING"].some((name) => yes(field(node, name)))) return result;
    if (["sales order", "purchase order", "delivery note", "receipt note", "stock journal", "physical stock", "material in", "material out"].includes(result.voucher_type.toLowerCase())) return result;
    const populated = (child) => children(child).length > 0;
    const all = children(node).filter((child) => nameOf(child) === "ALLLEDGERENTRIES.LIST" && populated(child));
    const allocations = all.length ? all : children(node).filter((child) => nameOf(child) === "LEDGERENTRIES.LIST" && populated(child));
    const groups = new Map();
    for (const allocation of allocations) {
      const ledger = field(allocation, "LEDGERNAME");
      const direction = field(allocation, "ISDEEMEDPOSITIVE");
      if (!ledger || !/^(yes|no|true|false|0|1)$/i.test(direction)) throw new Error("Tally returned incomplete ledger allocations during sync.");
      if (!groups.has(ledger)) groups.set(ledger, { ledger_name: ledger, debit_cents: 0, credit_cents: 0 });
      groups.get(ledger)[yes(direction) ? "debit_cents" : "credit_cents"] += cents(field(allocation, "AMOUNT"));
    }
    // A non-posting inventory voucher can legitimately have no ledger entries.
    // Accounting vouchers must never silently enter the cache without allocations.
    if (!allocations.length) throw new Error("Tally returned a posting voucher without ledger allocations; local sync was not published.");
    result.entries = [...groups.values()].map((entry) => ({ ...entry, particulars: [...groups.keys()].filter((name) => name !== entry.ledger_name) }));
    return result;
  });
  if (vouchers.length !== expected.size || new Set(vouchers.map((row) => row.id)).size !== expected.size) throw new Error("Tally returned an incomplete voucher sync batch; the previous snapshot has been preserved.");
  return vouchers;
}

