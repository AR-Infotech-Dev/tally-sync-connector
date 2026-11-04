import { fetchLedgerStatementRequest } from "../modules/ledgers/services/ledgerStatement.api.js";
import { createTallyHttpTransport } from "../utils/tally-connector-engine/transport/httpTransport.js";
import { escapeXml } from "../utils/tally-connector-engine/shared/utils/xmlHelpers.js";
import {
  records,
  field,
  children,
  nameOf,
  cents,
  yes,
} from "../utils/tally-connector-engine/modules/ledgers/statement.js";
import { buildCacheVoucherTypesRequest } from "../utils/tally-connector-engine/modules/ledgers/ledgerCache.mapper.js";

export function parseMovementVoucherTypes(xml) {
  return new Map(
    records(xml, "VOUCHERTYPE").map((node) => [
      String(node.getAttribute("NAME") || field(node, "NAME"))
        .trim()
        .toLowerCase(),
      field(node, "PARENT").trim().toLowerCase(),
    ]),
  );
}

export function movementVoucherKind(name, parents = new Map()) {
  let type = String(name).trim().toLowerCase();
  const visited = new Set();
  while (type && !visited.has(type)) {
    visited.add(type);
    if (["material in", "material out"].includes(type)) return "job_work";
    if (type === "stock journal") return "transfer";
    if (["sales order", "purchase order", "job work in order", "job work out order"].includes(type))
      return "order";
    type = parents.get(type);
  }
  return "party";
}

export function buildMovementAnalysisRequest(input) {
  const company = escapeXml(input.company);
  const item = escapeXml(input.stock_item);
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Flowups Item Movement</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${input.from_date.replaceAll("-", "")}</SVFROMDATE><SVTODATE TYPE="Date">${input.to_date.replaceAll("-", "")}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><FlowupsMovementItem TYPE="String">${item}</FlowupsMovementItem></STATICVARIABLES><TDL><TDLMESSAGE><VARIABLE NAME="FlowupsMovementItem"><TYPE>String</TYPE></VARIABLE><COLLECTION NAME="Flowups Item Movement"><TYPE>Voucher</TYPE><FETCH>Date,VoucherNumber,VoucherTypeName,PartyLedgerName,IsCancelled,IsOptional,IsOrderVoucher,AllInventoryEntries.*,InventoryEntries.*,InventoryEntriesIn.*,InventoryEntriesOut.*</FETCH><FILTER>FlowupsHasMovementItem</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="FlowupsMovementItemMatch">$StockItemName = ##FlowupsMovementItem</SYSTEM><SYSTEM TYPE="Formulae" NAME="FlowupsHasMovementItem">$$FilterCount:AllInventoryEntries:FlowupsMovementItemMatch &gt; 0</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

export function parseMovementAnalysis(xml, input, voucherTypes = new Map()) {
  const groups = new Map();
  for (const voucher of records(xml, "VOUCHER")) {
    if (["ISCANCELLED", "ISOPTIONAL", "ISORDERVOUCHER"].some((key) => yes(field(voucher, key))))
      continue;
    const voucherName = field(voucher, "VOUCHERTYPENAME");
    const category = movementVoucherKind(voucherName, voucherTypes);
    if (category === "order") continue;
    const all = children(voucher).filter((node) => nameOf(node) === "ALLINVENTORYENTRIES.LIST");
    const entries = all.length
      ? all
      : children(voucher).filter((node) =>
          ["INVENTORYENTRIES.LIST", "INVENTORYENTRIESIN.LIST", "INVENTORYENTRIESOUT.LIST"].includes(
            nameOf(node),
          ),
        );
    for (const entry of entries) {
      if (field(entry, "STOCKITEMNAME") !== input.stock_item) continue;
      const direction = field(entry, "ISDEEMEDPOSITIVE");
      if (!/^(yes|no)$/i.test(direction))
        throw new Error("Tally returned inventory without movement direction.");
      const movement = yes(direction) ? "inward" : "outward";
      if (input.movement_type !== "all" && input.movement_type !== movement) continue;
      const quantity = (field(entry, "BILLEDQTY") || field(entry, "ACTUALQTY")).match(
        /^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$/,
      );
      if (!quantity || quantity[2].includes("="))
        throw new Error(
          "This item uses an unsupported quantity format. Use a single base unit for movement analysis.",
        );
      const unit = quantity[2];
      const party =
        category === "party"
          ? field(voucher, "PARTYLEDGERNAME") || voucherName || "Other movements"
          : voucherName;
      const key = JSON.stringify([party, unit, category]);
      if (!groups.has(key))
        groups.set(key, {
          party,
          unit,
          category,
          inward_basic_value: 0,
          outward_basic_value: 0,
          inward_quantity: 0,
          inward_cents: 0,
          outward_quantity: 0,
          outward_cents: 0,
        });
      const row = groups.get(key);
      const qty = Math.abs(Number(quantity[1].replaceAll(",", "")));
      const rate = field(entry, "RATE").match(/^\s*([\d,]+(?:\.\d+)?)\s*\/\s*(.+?)\s*$/);
      if (rate && rate[2] !== unit)
        throw new Error(
          "Basic rate and quantity use different units; movement conversion is required.",
        );
      row[`${movement}_basic_value`] += rate ? qty * Number(rate[1].replaceAll(",", "")) : 0;
      row[`${movement}_quantity`] += qty;
      row[`${movement}_cents`] += cents(field(entry, "AMOUNT"));
    }
  }
  const rows = [...groups.values()]
    .sort((a, b) => a.party.localeCompare(b.party))
    .map((row) => ({
      ...row,
      inward_value: row.inward_cents / 100,
      outward_value: row.outward_cents / 100,
      inward_rate: row.inward_quantity ? row.inward_cents / 100 / row.inward_quantity : 0,
      outward_rate: row.outward_quantity ? row.outward_cents / 100 / row.outward_quantity : 0,
    }));
  return {
    company: input.company,
    stock_item: input.stock_item,
    from_date: input.from_date,
    to_date: input.to_date,
    movement_type: input.movement_type,
    rows,
    source: "tally_live",
  };
}

export async function fetchMovementAnalysis({ config, requestId, ledgerSync, companyAccess }) {
  const request = await fetchLedgerStatementRequest({ config, requestId });
  if (request.transaction_type !== "stock_item_movement" || !request.lookup)
    throw new Error("Invalid Stock Item Movement Analysis job.");
  const target = await companyAccess.resolve(request.lookup);
  const company = target.company;
  const timeoutMs = (Number(config.requestTimeoutSeconds) || 30) * 1000;
  const item = ledgerSync.resolveStockItem(config, { ...request.lookup, ...target });
  const input = { ...request.lookup, ...item, company };
  const transport = createTallyHttpTransport();
  const typesResponse = await transport.postXml(
    { url: config.tallyUrl },
    buildCacheVoucherTypesRequest(company),
    { timeoutMs },
  );
  if (typesResponse.status < 200 || typesResponse.status >= 300)
    throw new Error(`Tally voucher type export returned HTTP ${typesResponse.status}.`);
  const voucherTypes = parseMovementVoucherTypes(typesResponse.body);
  await companyAccess.assertTarget(target);
  const response = await transport.postXml(
    { url: config.tallyUrl },
    buildMovementAnalysisRequest(input),
    { timeoutMs },
  );
  if (response.status < 200 || response.status >= 300)
    throw new Error(`Tally movement export returned HTTP ${response.status}.`);
  const report = parseMovementAnalysis(response.body, input, voucherTypes);
  // Company metadata belongs to the same GUID-scoped cache as other reports.
  report.company_details = ledgerSync.companyDetails(config, company, target.company_guid);
  return report;
}
