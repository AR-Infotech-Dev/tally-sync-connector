import { resolveMovementScope } from "./movementScope.service.js";
import { setTimeout as delay } from "node:timers/promises";
import { initialManifestRanges, splitSyncDateRange } from "./ledgerSync.batches.js";
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

export function buildMovementAnalysisRequest(input, { firstId = 1, lastId = 2147483647 } = {}) {
  if (
    !Number.isSafeInteger(firstId) ||
    !Number.isSafeInteger(lastId) ||
    firstId < 1 ||
    lastId < firstId
  )
    throw new Error("Invalid movement voucher ID range.");
  const company = escapeXml(input.company);
  const item = escapeXml(input.stock_item || "");
  const literal = (value) => '"' + String(value).replaceAll('"', () => '" + $$Char:34 + "') + '"';
  const equal = (method, values) =>
    values.length
      ? "(" + values.map((value) => method + " = " + literal(value)).join(" OR ") + ")"
      : "No";
  const type = input.analysis_type || "stock-item";
  const inventoryMatch = input.selected_items
    ? equal("$StockItemName", input.selected_items)
    : type === "stock-item"
      ? "$StockItemName = ##FlowupsMovementItem"
      : "Yes";
  const partyMatch = input.selected_ledgers
    ? equal("$PartyLedgerName", input.selected_ledgers)
    : "Yes";
  const voucherMatch =
    type === "transfer" ? equal("$VoucherTypeName", [input.voucher_type]) : "Yes";
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>Flowups Item Movement</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">${input.from_date.replaceAll("-", "")}</SVFROMDATE><SVTODATE TYPE="Date">${input.to_date.replaceAll("-", "")}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><FlowupsMovementItem TYPE="String">${item}</FlowupsMovementItem></STATICVARIABLES><TDL><TDLMESSAGE><VARIABLE NAME="FlowupsMovementItem"><TYPE>String</TYPE></VARIABLE><COLLECTION NAME="Flowups Item Movement"><TYPE>Voucher</TYPE><FETCH>MasterID,Date,VoucherNumber,VoucherTypeName,PartyLedgerName,IsCancelled,IsOptional,IsOrderVoucher,AllInventoryEntries.StockItemName,AllInventoryEntries.IsDeemedPositive,AllInventoryEntries.BilledQty,AllInventoryEntries.ActualQty,AllInventoryEntries.Rate,AllInventoryEntries.Amount,InventoryEntries.StockItemName,InventoryEntries.IsDeemedPositive,InventoryEntries.BilledQty,InventoryEntries.ActualQty,InventoryEntries.Rate,InventoryEntries.Amount,InventoryEntriesIn.StockItemName,InventoryEntriesIn.IsDeemedPositive,InventoryEntriesIn.BilledQty,InventoryEntriesIn.ActualQty,InventoryEntriesIn.Rate,InventoryEntriesIn.Amount,InventoryEntriesOut.StockItemName,InventoryEntriesOut.IsDeemedPositive,InventoryEntriesOut.BilledQty,InventoryEntriesOut.ActualQty,InventoryEntriesOut.Rate,InventoryEntriesOut.Amount</FETCH><FILTER>FlowupsMovementPeriod</FILTER></COLLECTION><SYSTEM TYPE="Formulae" NAME="FlowupsMovementPeriod">($Date &gt;= ##SVFromDate) AND ($Date &lt;= ##SVToDate) AND ($MasterID &gt;= ${firstId}) AND ($MasterID &lt;= ${lastId}) AND ${escapeXml(partyMatch)} AND ${escapeXml(voucherMatch)} AND ($$FilterCount:AllInventoryEntries:FlowupsMovementItemMatch &gt; 0)</SYSTEM><SYSTEM TYPE="Formulae" NAME="FlowupsMovementItemMatch">${escapeXml(inventoryMatch)}</SYSTEM><SYSTEM TYPE="Formulae" NAME="FlowupsHasMovementItem">$$FilterCount:AllInventoryEntries:FlowupsMovementItemMatch &gt; 0</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
}

export function parseMovementAnalysis(xml, input, voucherTypes = new Map()) {
  const groups = new Map();
  const type = input.analysis_type || "stock-item";
  const selectedItems = input.selected_items ? new Set(input.selected_items) : null;
  const selectedLedgers = input.selected_ledgers ? new Set(input.selected_ledgers) : null;
  for (const voucher of records(xml, "VOUCHER")) {
    if (["ISCANCELLED", "ISOPTIONAL", "ISORDERVOUCHER"].some((key) => yes(field(voucher, key))))
      continue;
    const voucherName = field(voucher, "VOUCHERTYPENAME");
    const category = movementVoucherKind(voucherName, voucherTypes);
    if (category === "order") continue;
    if (selectedLedgers && !selectedLedgers.has(field(voucher, "PARTYLEDGERNAME"))) continue;
    if (type === "transfer" && (category !== "transfer" || voucherName !== input.voucher_type))
      continue;
    const all = children(voucher).filter((node) => nameOf(node) === "ALLINVENTORYENTRIES.LIST");
    const entries = all.length
      ? all
      : children(voucher).filter((node) =>
          ["INVENTORYENTRIES.LIST", "INVENTORYENTRIESIN.LIST", "INVENTORYENTRIESOUT.LIST"].includes(
            nameOf(node),
          ),
        );
    for (const entry of entries) {
      const stockItem = field(entry, "STOCKITEMNAME");
      if (type === "stock-item" && stockItem !== input.stock_item) continue;
      if (selectedItems && !selectedItems.has(stockItem)) continue;
      if (!stockItem) throw new Error("Tally returned movement inventory without a stock item.");
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
        type !== "stock-item"
          ? stockItem
          : category === "party"
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
  const rows = movementTotals([...groups.values()]);
  return {
    company: input.company,
    stock_item: input.stock_item,
    analysis_type: type,
    analysis_label: input.analysis_label || input.stock_item,
    from_date: input.from_date,
    to_date: input.to_date,
    movement_type: input.movement_type,
    rows,
    source: "tally_live",
  };
}

function movementTotals(values) {
  return values
    .sort((a, b) => a.party.localeCompare(b.party))
    .map((row) => ({
      ...row,
      inward_value: row.inward_cents / 100,
      outward_value: row.outward_cents / 100,
      inward_rate: row.inward_quantity ? row.inward_cents / 100 / row.inward_quantity : 0,
      outward_rate: row.outward_quantity ? row.outward_cents / 100 / row.outward_quantity : 0,
    }));
}

export async function readMovementAnalysis({
  input,
  transport,
  tallyUrl,
  timeoutMs,
  voucherTypes = new Map(),
  assertTarget = async () => {},
  pauseMs = 100,
}) {
  const groups = new Map();
  const seen = new Set();
  let activeInput = input;
  let partition = 0;
  let requests = 0;
  const asIso = (date) => date.slice(0, 4) + "-" + date.slice(4, 6) + "-" + date.slice(6, 8);
  async function read(from, to, firstId = 1, lastId = 2147483647) {
    if (++requests > 1024)
      throw new Error(
        "Movement report requires too many Tally requests. Use a shorter date range.",
      );
    await assertTarget();
    if (requests > 1 && pauseMs) await delay(pauseMs);
    const chunk = { ...activeInput, from_date: asIso(from), to_date: asIso(to) };
    let response;
    try {
      response = await transport.postXml(
        { url: tallyUrl },
        buildMovementAnalysisRequest(chunk, { firstId, lastId }),
        { timeoutMs },
      );
    } catch (error) {
      if (!["TALLY_RESPONSE_TOO_LARGE", "TALLY_TIMEOUT"].includes(error.code)) throw error;
      const dates = splitSyncDateRange(from, to);
      if (dates) {
        for (const [start, end] of dates) await read(start, end, firstId, lastId);
        return;
      }
      if (error.code === "TALLY_TIMEOUT")
        throw Object.assign(
          new Error(
            "Tally timed out while reading movement on " +
              asIso(from) +
              ". No partial report was generated; retry when Tally is available.",
            { cause: error },
          ),
          { code: error.code },
        );
      if (firstId < lastId) {
        const middle = Math.floor((firstId + lastId) / 2);
        await read(from, to, firstId, middle);
        await read(from, to, middle + 1, lastId);
        return;
      }
      throw Object.assign(
        new Error(
          "Movement voucher MasterID " +
            firstId +
            " on " +
            asIso(from) +
            " could not be read within Tally limits. No partial report was generated.",
          { cause: error },
        ),
        { code: error.code },
      );
    }
    if (response.status < 200 || response.status >= 300)
      throw new Error("Tally movement export returned HTTP " + response.status + ".");
    const vouchers = records(response.body, "VOUCHER");
    const ids = [];
    for (const voucher of vouchers) {
      const date = field(voucher, "DATE").replaceAll("-", "");
      const id = Number(field(voucher, "MASTERID"));
      if (
        !/^\d{8}$/.test(date) ||
        date < from ||
        date > to ||
        !Number.isSafeInteger(id) ||
        id < firstId ||
        id > lastId
      )
        throw new Error(
          "Tally returned movement data outside the requested date or voucher ID range. No partial report was generated.",
        );
      if (seen.has(partition + ":" + id) || ids.includes(id))
        throw new Error(
          "Tally movement vouchers changed between chunks. Retry the report; duplicate vouchers were not counted.",
        );
      ids.push(id);
    }
    const parsed = parseMovementAnalysis(response.body, chunk, voucherTypes);
    ids.forEach((id) => seen.add(partition + ":" + id));
    for (const row of parsed.rows) {
      const key = JSON.stringify([row.party, row.unit, row.category]);
      if (!groups.has(key)) groups.set(key, { ...row });
      else {
        const total = groups.get(key);
        for (const name of [
          "inward_basic_value",
          "outward_basic_value",
          "inward_quantity",
          "outward_quantity",
          "inward_cents",
          "outward_cents",
        ])
          total[name] += row[name];
      }
    }
  }
  const selector = input.selected_items
    ? "selected_items"
    : input.selected_ledgers
      ? "selected_ledgers"
      : null;
  const selections = selector ? input[selector] : null;
  const partitions = selector
    ? Array.from({ length: Math.ceil(selections.length / 100) }, (_, index) => ({
        ...input,
        [selector]: selections.slice(index * 100, index * 100 + 100),
      }))
    : [input];
  for (const selection of partitions) {
    activeInput = selection;
    partition++;
    for (const [from, to] of initialManifestRanges(
      input.from_date.replaceAll("-", ""),
      input.to_date.replaceAll("-", ""),
    ))
      await read(from, to);
  }
  await assertTarget();
  const { selected_items, selected_ledgers, ...metadata } = input;
  return { ...metadata, rows: movementTotals([...groups.values()]), source: "tally_live" };
}

export async function fetchMovementAnalysis({
  config,
  requestId,
  ledgerSync,
  companyAccess,
  transport = createTallyHttpTransport(),
  fetchRequest = fetchLedgerStatementRequest,
}) {
  const request = await fetchRequest({ config, requestId });
  if (request.transaction_type !== "stock_item_movement" || !request.lookup)
    throw new Error("Invalid Movement Analysis job.");
  const target = await companyAccess.resolve(request.lookup);
  const company = target.company;
  const timeoutMs = (Number(config.requestTimeoutSeconds) || 30) * 1000;
  const type = request.lookup.analysis_type || "stock-item";
  const selected =
    type === "stock-item"
      ? ledgerSync.resolveStockItem(config, { ...request.lookup, ...target })
      : type === "ledger"
        ? ledgerSync.resolveLedger(config, { ...request.lookup, ...target })
        : {};
  const lookup = { ...request.lookup, ...selected, company };
  const typesResponse = await transport.postXml(
    { url: config.tallyUrl },
    buildCacheVoucherTypesRequest(company),
    { timeoutMs },
  );
  if (typesResponse.status < 200 || typesResponse.status >= 300)
    throw new Error(`Tally voucher type export returned HTTP ${typesResponse.status}.`);
  const voucherTypes = parseMovementVoucherTypes(typesResponse.body);
  if (type === "transfer" && movementVoucherKind(lookup.voucher_type, voucherTypes) !== "transfer")
    throw Object.assign(
      new Error(
        "Transfer analysis requires Stock Journal or a voucher type derived from Stock Journal.",
      ),
      { httpStatus: 400 },
    );
  const input = await resolveMovementScope({
    input: lookup,
    transport,
    tallyUrl: config.tallyUrl,
    timeoutMs,
    assertTarget: () => companyAccess.assertTarget(target),
  });
  const report = await readMovementAnalysis({
    input,
    transport,
    tallyUrl: config.tallyUrl,
    timeoutMs,
    voucherTypes,
    assertTarget: () => companyAccess.assertTarget(target),
  });
  // Company metadata belongs to the same GUID-scoped cache as other reports.
  report.company_details = ledgerSync.companyDetails(config, company, target.company_guid);
  return report;
}
