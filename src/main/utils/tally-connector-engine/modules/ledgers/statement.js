import { escapeXml } from "../../shared/utils/xmlHelpers.js";
import { parseTallyDocument } from "../../shared/parsers/voucherJson.js";

function envelope(lookup, name, definition) {
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${name}</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${escapeXml(lookup.company)}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">19000101</SVFROMDATE><SVTODATE TYPE="Date">${lookup.to_date.replaceAll("-", "")}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><FlowupsStatementLedger TYPE="String">${escapeXml(lookup.ledger_name)}</FlowupsStatementLedger></STATICVARIABLES><TDL><TDLMESSAGE><VARIABLE NAME="FlowupsStatementLedger"><TYPE>String</TYPE></VARIABLE>${definition}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

export function buildLedgerStatementMasterRequest(lookup) {
  return envelope(lookup, "Flowups Statement Ledger", '<COLLECTION NAME="Flowups Statement Ledger"><TYPE>Ledger</TYPE><FETCH>Name,OpeningBalance</FETCH><COMPUTE>FlowupsOpeningAmount : $$AsPositive:$OpeningBalance</COMPUTE><COMPUTE>FlowupsOpeningDr : $$IsDr:$OpeningBalance</COMPUTE><FILTER>Flowups Statement Name</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="Flowups Statement Name">$Name = ##FlowupsStatementLedger</SYSTEM>');
}

export function buildLedgerStatementEntriesRequest(lookup, { allVouchers = false } = {}) {
  const scope = allVouchers ? '<TYPE>Voucher</TYPE>' : '<TYPE>Voucher : Ledger</TYPE><CHILDOF>##FlowupsStatementLedger</CHILDOF>';
  return envelope(lookup, "Flowups Statement Vouchers", `<COLLECTION NAME="Flowups Statement Vouchers">${scope}<FETCH>MasterID,Date,VoucherNumber,VoucherTypeName,Narration,IsCancelled,IsOptional,IsOrderVoucher,AllLedgerEntries.*,LedgerEntries.*</FETCH><COMPUTE>FlowupsNonPosting : $$IsSalesOrder:$VoucherTypeName OR $$IsPurcOrder:$VoucherTypeName OR $$IsDelNote:$VoucherTypeName OR $$IsRcptNote:$VoucherTypeName OR $$IsStockJournal:$VoucherTypeName OR $$IsPhyStock:$VoucherTypeName</COMPUTE></COLLECTION>`);
}

export function countLedgerStatementVouchers(xml) { return records(xml, "VOUCHER").length; }

export const nameOf = (node) => (node.localName || node.nodeName).toUpperCase();
export const children = (node) => Array.from(node.childNodes || []).filter((child) => child.nodeType === 1);
export const field = (node, name) => children(node).find((child) => nameOf(child) === name)?.textContent.trim() || "";
export const yes = (value) => /^(yes|true|1)$/i.test(value);
export function records(xml, name) {
  const document = parseTallyDocument(xml);
  const elements = Array.from(document.getElementsByTagName("*"));
  if (elements.some((node) => ["LINEERROR", "ERRORMSG", "ERROR"].includes(nameOf(node)) || (nameOf(node) === "STATUS" && node.textContent.trim() === "0"))) throw new Error("Tally rejected the ledger statement export. Confirm the company is open.");
  if (!elements.some((node) => nameOf(node) === "COLLECTION")) throw new Error("Tally did not return the requested statement collection.");
  return elements.filter((node) => {
    if (nameOf(node) !== name) return false;
    for (let parent = node.parentNode; parent?.nodeType === 1; parent = parent.parentNode) if (["HEADER", "DESC", "CMPINFO", name].includes(nameOf(parent))) return false;
    return true;
  });
}

export function cents(value) {
  const cleaned = String(value).replaceAll(",", "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) throw new Error(`Tally returned an invalid statement amount.`);
  const amount = Math.round(Math.abs(Number(cleaned)) * 100);
  if (!Number.isSafeInteger(amount)) throw new Error("Statement amount exceeds the supported range.");
  return amount;
}
const balance = (value) => ({ amount: Math.abs(value) / 100, type: value > 0 ? "Dr" : value < 0 ? "Cr" : null });

export function normalizeLedgerStatement(masterXml, entriesXml, lookup, { allVouchers = false } = {}) {
  const ledgers = records(masterXml, "LEDGER").filter((node) => field(node, "NAME") === lookup.ledger_name || node.getAttribute("NAME") === lookup.ledger_name);
  if (!ledgers.length) { const error = new Error("Ledger not found in the selected Tally company."); error.httpStatus = 404; throw error; }
  if (ledgers.length !== 1) throw new Error("Tally returned multiple matching ledger masters.");
  const openingText = field(ledgers[0], "FLOWUPSOPENINGAMOUNT");
  if (!openingText) throw new Error("Tally did not return the ledger opening amount.");
  const openingDr = field(ledgers[0], "FLOWUPSOPENINGDR");
  if (!/^(yes|no|true|false|0|1)$/i.test(openingDr)) throw new Error("Tally did not return the ledger opening balance direction.");
  let opening = cents(openingText) * (yes(openingDr) ? 1 : -1);
  const movements = [];
  const vouchers = records(entriesXml, "VOUCHER");
  let matchedVouchers = 0;
  for (const voucher of vouchers) {
    if (["ISCANCELLED", "ISOPTIONAL", "ISORDERVOUCHER", "FLOWUPSNONPOSTING"].some((name) => yes(field(voucher, name)))) continue;
    if (["sales order", "purchase order", "delivery note", "receipt note", "stock journal", "physical stock"].includes(field(voucher, "VOUCHERTYPENAME").toLowerCase())) continue;
    const rawDate = field(voucher, "DATE");
    if (!/^\d{8}$/.test(rawDate)) throw new Error("Tally returned an invalid statement voucher date.");
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;
    if (date > lookup.to_date) continue;
    const allEntries = children(voucher).filter((node) => nameOf(node) === "ALLLEDGERENTRIES.LIST");
    const allocations = allEntries.length ? allEntries : children(voucher).filter((node) => nameOf(node) === "LEDGERENTRIES.LIST");
    if (!allocations.length) {
      if (allVouchers) continue;
      throw new Error("Tally returned statement vouchers without ledger allocations. Update the Connector and retry.");
    }
    const matchingEntries = allocations.filter((node) => field(node, "LEDGERNAME") === lookup.ledger_name);
    if (!matchingEntries.length) {
      if (allVouchers) continue;
      throw new Error("Tally returned a ledger statement voucher without the requested ledger allocation.");
    }
    matchedVouchers++;
    let debit = 0; let credit = 0;
    for (const entry of matchingEntries) {
      const amount = cents(field(entry, "AMOUNT"));
      const direction = field(entry, "ISDEEMEDPOSITIVE");
      if (!/^(yes|no|true|false|0|1)$/i.test(direction)) throw new Error("Tally did not return the ledger entry debit/credit direction.");
      if (yes(direction)) debit += amount; else credit += amount;
    }
    if (!debit && !credit) continue;
    if (date < lookup.from_date) { opening += debit - credit; continue; }
    movements.push({ date, voucher_no: field(voucher, "VOUCHERNUMBER"), voucher_type: field(voucher, "VOUCHERTYPENAME"), master_id: field(voucher, "MASTERID"), narration: field(voucher, "NARRATION"), particulars: [...new Set(allocations.map((node) => field(node, "LEDGERNAME")).filter((name) => name && name !== lookup.ledger_name))], debit, credit });
  }
  movements.sort((a, b) => a.date.localeCompare(b.date) || Number(a.master_id) - Number(b.master_id));
  let running = opening; let totalDebit = 0; let totalCredit = 0;
  const entries = movements.map((entry) => {
    running += entry.debit - entry.credit;
    totalDebit += entry.debit; totalCredit += entry.credit;
    return { ...entry, debit: entry.debit / 100, credit: entry.credit / 100, balance: balance(running) };
  });
  return { company: lookup.company, ledger_name: lookup.ledger_name, from_date: lookup.from_date, to_date: lookup.to_date, opening_balance: balance(opening), entries, total_debit: totalDebit / 100, total_credit: totalCredit / 100, closing_balance: balance(running), ...(entries.length ? {} : { diagnostics: { query_version: "ledger-statement-v2", query_mode: allVouchers ? "voucher_collection" : "ledger_collection", tally_vouchers: vouchers.length, matched_ledger_vouchers: matchedVouchers, period_entries: 0 } }) };
}
