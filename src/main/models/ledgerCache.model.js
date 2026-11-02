import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { companyNameKey } from "../utils/companyName.js";
import { createStockItemCache } from "./stockItemCache.model.js";

export const cacheScope = (config) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        config.serverUrl.replace(/\/+$/, ""),
        config.clientId,
        config.tallyUrl.replace(/\/+$/, ""),
      ]),
    )
    .digest("hex");
const balance = (value) => ({
  amount: Math.abs(value) / 100,
  type: value > 0 ? "Dr" : value < 0 ? "Cr" : null,
});
const cacheError = (message, status = 503) =>
  Object.assign(new Error(message), { httpStatus: status });

export function createLedgerCache(filePath) {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS cache_companies (
      scope TEXT NOT NULL, guid TEXT NOT NULL, name TEXT NOT NULL, dataset TEXT NOT NULL,
      last_synced_at TEXT, last_attempt_at TEXT, sync_status TEXT NOT NULL DEFAULT 'pending', sync_error TEXT, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(scope,guid));
    CREATE INDEX IF NOT EXISTS cache_company_name ON cache_companies(scope,name);
    CREATE TABLE IF NOT EXISTS cache_ledgers(dataset TEXT NOT NULL,name TEXT NOT NULL,parent_group TEXT NOT NULL DEFAULT '',dealer_code TEXT NOT NULL DEFAULT '',master_id TEXT NOT NULL,guid TEXT NOT NULL,opening_cents INTEGER NOT NULL,PRIMARY KEY(dataset,name));
    CREATE INDEX IF NOT EXISTS cache_ledger_dealer_code ON cache_ledgers(dataset,dealer_code);
    CREATE TABLE IF NOT EXISTS cache_vouchers(dataset TEXT NOT NULL,id TEXT NOT NULL,alter_id TEXT NOT NULL,signature TEXT NOT NULL,date TEXT NOT NULL,voucher_no TEXT NOT NULL,voucher_type TEXT NOT NULL,narration TEXT NOT NULL,PRIMARY KEY(dataset,id));
    CREATE TABLE IF NOT EXISTS cache_entries(dataset TEXT NOT NULL,voucher_id TEXT NOT NULL,ledger_name TEXT NOT NULL,debit_cents INTEGER NOT NULL,credit_cents INTEGER NOT NULL,particulars TEXT NOT NULL,
      PRIMARY KEY(dataset,voucher_id,ledger_name),FOREIGN KEY(dataset,voucher_id) REFERENCES cache_vouchers(dataset,id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS cache_statement_entries ON cache_entries(dataset,ledger_name,voucher_id);
    CREATE INDEX IF NOT EXISTS cache_statement_dates ON cache_vouchers(dataset,date,id);
    CREATE TABLE IF NOT EXISTS cache_manifest(dataset TEXT NOT NULL,id TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(dataset,id));
    `);
  // Older Connector builds already created this database without active.
  // Upgrade in place; never require deleting the user's synced history.
  const companyColumns = db.prepare("PRAGMA table_info(cache_companies)").all();
  if (!companyColumns.some((column) => column.name === "active"))
    db.exec("ALTER TABLE cache_companies ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  for (const [table, column, definition] of [
    ["cache_ledgers", "parent_group", "TEXT NOT NULL DEFAULT ''"],
    ["cache_ledgers", "dealer_code", "TEXT NOT NULL DEFAULT ''"],
    ["cache_vouchers", "details_json", "TEXT"],
    ["cache_entries", "bill_allocations_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["cache_companies", "company_details_json", "TEXT NOT NULL DEFAULT '{}'"],
  ]) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((item) => item.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  const stockItems = createStockItemCache(db, transaction);
  db.exec("PRAGMA user_version=4");
  // Only unpublished staging rows belong to interrupted local sync attempts.
  db.exec(
    "DELETE FROM cache_entries WHERE dataset LIKE 'stage:%'; DELETE FROM cache_vouchers WHERE dataset LIKE 'stage:%'; DELETE FROM cache_ledgers WHERE dataset LIKE 'stage:%'; DELETE FROM cache_manifest WHERE dataset LIKE 'stage:%';",
  );

  function transaction(callback) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  function company(scope, guid) {
    return db.prepare("SELECT * FROM cache_companies WHERE scope=? AND guid=?").get(scope, guid);
  }
  function summary(scope, name) {
    const rows = db
      .prepare(
        `SELECT c.name,c.last_synced_at,c.sync_status,c.sync_error,
      (SELECT COUNT(*) FROM cache_ledgers WHERE dataset=c.dataset) AS ledgers,
      (SELECT COUNT(*) FROM cache_vouchers WHERE dataset=c.dataset) AS vouchers,
      (SELECT COUNT(*) FROM cache_entries WHERE dataset=c.dataset) AS entries
      FROM cache_companies c WHERE c.scope=? AND c.active=1 ORDER BY c.name`,
      )
      .all(scope)
      .filter((row) => !name || companyNameKey(row.name) === companyNameKey(name));
    return {
      companies: rows,
      cached_ledgers: rows.reduce((sum, row) => sum + row.ledgers, 0),
      cached_vouchers: rows.reduce((sum, row) => sum + row.vouchers, 0),
      cached_entries: rows.reduce((sum, row) => sum + row.entries, 0),
    };
  }
  function listCompanies(scope) {
    return db
      .prepare(
        "SELECT guid,name,last_synced_at,sync_status,sync_error,active FROM cache_companies WHERE scope=? ORDER BY name",
      )
      .all(scope);
  }
  function failScope(scope, error) {
    db.prepare(
      "UPDATE cache_companies SET sync_status='failed',sync_error=?,last_attempt_at=? WHERE scope=?",
    ).run(String(error.message || error).slice(0, 500), new Date().toISOString(), scope);
  }
  function begin(scope, identity) {
    const dataset = `live:${scope}:${identity.guid}`;
    const stage = `stage:${randomUUID()}`;
    db.prepare(
      "INSERT INTO cache_companies(scope,guid,name,dataset,last_attempt_at,sync_status,active) VALUES(?,?,?,?,?,'syncing',0) ON CONFLICT(scope,guid) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,sync_status='syncing',sync_error=NULL",
    ).run(scope, identity.guid, identity.name, dataset, new Date().toISOString());
    return { scope, ...identity, dataset, stage };
  }
  function signatures(run) {
    return new Map(
      db
        .prepare("SELECT id,signature FROM cache_vouchers WHERE dataset=?")
        .all(run.dataset)
        .map((row) => [row.id, row.signature]),
    );
  }
  function incompleteDetails(run) {
    // Signature equality does not prove a pre-upgrade row has detailed data.
    // Exclude non-posting vouchers: they legitimately have no ledger entries.
    return new Set(
      db
        .prepare(
          `SELECT v.id FROM cache_vouchers v WHERE v.dataset=? AND v.details_json IS NULL
      AND EXISTS(SELECT 1 FROM cache_entries e WHERE e.dataset=v.dataset AND e.voucher_id=v.id)`,
        )
        .all(run.dataset)
        .map((row) => row.id),
    );
  }
  function ledgers(run) {
    return db
      .prepare(
        "SELECT name,parent_group,dealer_code,master_id,guid,opening_cents FROM cache_ledgers WHERE dataset=? ORDER BY name",
      )
      .all(run.dataset);
  }
  function stageLedgers(run, rows) {
    const insert = db.prepare(
      "INSERT INTO cache_ledgers(dataset,name,parent_group,dealer_code,master_id,guid,opening_cents) VALUES(?,?,?,?,?,?,?)",
    );
    transaction(() => {
      for (const row of rows)
        insert.run(
          run.stage,
          row.name,
          row.parent_group || "",
          row.dealer_code || "",
          row.master_id,
          row.guid,
          row.opening_cents,
        );
    });
  }
  function stageVouchers(run, rows) {
    const voucher = db.prepare(
      "INSERT INTO cache_vouchers(dataset,id,alter_id,signature,date,voucher_no,voucher_type,narration,details_json) VALUES(?,?,?,?,?,?,?,?,?)",
    );
    const entry = db.prepare(
      "INSERT INTO cache_entries(dataset,voucher_id,ledger_name,debit_cents,credit_cents,particulars,bill_allocations_json) VALUES(?,?,?,?,?,?,?)",
    );
    transaction(() => {
      for (const row of rows) {
        voucher.run(
          run.stage,
          row.id,
          row.alter_id,
          row.signature,
          row.date,
          row.voucher_no,
          row.voucher_type,
          row.narration,
          row.details_version
            ? JSON.stringify({
                inventory_entries: row.inventory_entries || [],
                bank_allocations: row.bank_allocations || [],
                version: row.details_version,
              })
            : null,
        );
        for (const allocation of row.entries)
          entry.run(
            run.stage,
            row.id,
            allocation.ledger_name,
            allocation.debit_cents,
            allocation.credit_cents,
            JSON.stringify(allocation.particulars),
            JSON.stringify(allocation.bill_allocations || []),
          );
      }
    });
  }
  function discard(run) {
    transaction(() => {
      stockItems.discardStockItems(run);
      db.prepare("DELETE FROM cache_vouchers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_manifest WHERE dataset=?").run(run.stage);
    });
  }
  function fail(run, error) {
    discard(run);
    db.prepare(
      "UPDATE cache_companies SET sync_status='failed',sync_error=? WHERE scope=? AND guid=?",
    ).run(String(error.message || error).slice(0, 500), run.scope, run.guid);
  }
  function publish(run, manifest) {
    const now = new Date().toISOString();
    transaction(() => {
      const insert = db.prepare("INSERT INTO cache_manifest VALUES(?,?,?)");
      for (const row of manifest) insert.run(run.stage, row.id, row.signature);
      // Delete disappeared, cancelled/replaced and changed versions atomically;
      // cascading removes the old ledger allocations before replacement.
      db.prepare(
        "DELETE FROM cache_vouchers WHERE dataset=? AND (id NOT IN (SELECT id FROM cache_manifest WHERE dataset=?) OR id IN (SELECT id FROM cache_vouchers WHERE dataset=?))",
      ).run(run.dataset, run.stage, run.stage);
      db.prepare(
        "INSERT INTO cache_vouchers(dataset,id,alter_id,signature,date,voucher_no,voucher_type,narration,details_json) SELECT ?,id,alter_id,signature,date,voucher_no,voucher_type,narration,details_json FROM cache_vouchers WHERE dataset=?",
      ).run(run.dataset, run.stage);
      db.prepare(
        "INSERT INTO cache_entries(dataset,voucher_id,ledger_name,debit_cents,credit_cents,particulars,bill_allocations_json) SELECT ?,voucher_id,ledger_name,debit_cents,credit_cents,particulars,bill_allocations_json FROM cache_entries WHERE dataset=?",
      ).run(run.dataset, run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.dataset);
      db.prepare(
        "INSERT INTO cache_ledgers(dataset,name,parent_group,dealer_code,master_id,guid,opening_cents) SELECT ?,name,parent_group,dealer_code,master_id,guid,opening_cents FROM cache_ledgers WHERE dataset=?",
      ).run(run.dataset, run.stage);
      stockItems.publishStockItems(run);
      const previousNames = db
        .prepare("SELECT guid,name FROM cache_companies WHERE scope=? AND guid<>?")
        .all(run.scope, run.guid);
      for (const previous of previousNames.filter(
        (row) => companyNameKey(row.name) === companyNameKey(run.name),
      ))
        db.prepare("UPDATE cache_companies SET active=0 WHERE scope=? AND guid=?").run(
          run.scope,
          previous.guid,
        );
      db.prepare(
        "UPDATE cache_companies SET name=?,last_synced_at=?,sync_status='ready',sync_error=NULL,active=1,company_details_json=? WHERE scope=? AND guid=?",
      ).run(run.name, now, JSON.stringify(run.company_details || {}), run.scope, run.guid);
      db.prepare("DELETE FROM cache_vouchers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_manifest WHERE dataset=?").run(run.stage);
    });
    return now;
  }
  function statement(scope, input, { syncing = false, connected = true } = {}) {
    const matches = db
      .prepare(
        "SELECT * FROM cache_companies WHERE scope=? AND active=1 ORDER BY last_synced_at DESC",
      )
      .all(scope)
      .filter((row) => companyNameKey(row.name) === companyNameKey(input.company));
    if (!matches.length || !matches[0].last_synced_at)
      throw cacheError(
        "Local ledger cache is not ready for this company. Keep Connector and Tally connected until the initial sync completes.",
      );
    if (matches.length > 1)
      throw cacheError(
        "Multiple cached company GUIDs share this name. Select a uniquely named company in Tally.",
        409,
      );
    const cached = matches[0];
    const ledger = db
      .prepare("SELECT * FROM cache_ledgers WHERE dataset=? AND name=?")
      .get(cached.dataset, input.ledger_name);
    if (!ledger) throw cacheError("Ledger not found in the last synced local snapshot.", 404);
    const prior = db
      .prepare(
        "SELECT COALESCE(SUM(e.debit_cents-e.credit_cents),0) AS movement FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id WHERE e.dataset=? AND e.ledger_name=? AND v.date<?",
      )
      .get(cached.dataset, input.ledger_name, input.from_date);
    const opening = ledger.opening_cents + prior.movement;
    let running = opening;
    let debit = 0;
    let credit = 0;
    const rows = db
      .prepare(
        "SELECT v.*,e.debit_cents,e.credit_cents,e.particulars,e.bill_allocations_json FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id WHERE e.dataset=? AND e.ledger_name=? AND v.date>=? AND v.date<=? AND (e.debit_cents<>0 OR e.credit_cents<>0) ORDER BY v.date,CAST(v.id AS INTEGER)",
      )
      .all(cached.dataset, input.ledger_name, input.from_date, input.to_date);
    const entries = rows.map((row) => {
      running += row.debit_cents - row.credit_cents;
      debit += row.debit_cents;
      credit += row.credit_cents;
      return {
        date: row.date,
        voucher_no: row.voucher_no,
        voucher_type: row.voucher_type,
        master_id: row.id,
        narration: row.narration,
        particulars: JSON.parse(row.particulars),
        inventory_entries: JSON.parse(row.details_json || "{}").inventory_entries || [],
        ...(JSON.parse(row.details_json || "{}").version >= 2
          ? { bank_allocations: JSON.parse(row.details_json).bank_allocations || [] }
          : {}),
        bill_allocations: JSON.parse(row.bill_allocations_json),
        debit: row.debit_cents / 100,
        credit: row.credit_cents / 100,
        balance: balance(running),
      };
    });
    const stale =
      !connected ||
      cached.sync_status === "failed" ||
      Date.now() - Date.parse(cached.last_synced_at) > 180_000;
    return {
      company: cached.name,
      company_details: JSON.parse(cached.company_details_json),
      details_available: rows.every((row) => row.details_json !== null),
      ledger_name: input.ledger_name,
      from_date: input.from_date,
      to_date: input.to_date,
      opening_balance: balance(opening),
      entries,
      total_debit: debit / 100,
      total_credit: credit / 100,
      closing_balance: balance(running),
      source: "local_sqlite",
      last_synced_at: cached.last_synced_at,
      sync_status: syncing ? "syncing" : stale ? "stale" : "ready",
      is_stale: stale,
      ...(cached.sync_error ? { sync_error: cached.sync_error } : {}),
    };
  }
  function groupSummary(scope, input, { syncing = false, connected = true } = {}) {
    const matches = db
      .prepare(
        "SELECT * FROM cache_companies WHERE scope=? AND active=1 ORDER BY last_synced_at DESC",
      )
      .all(scope)
      .filter((row) => companyNameKey(row.name) === companyNameKey(input.company));
    if (!matches.length || !matches[0].last_synced_at)
      throw cacheError(
        "Local ledger cache is not ready for this company. Keep Connector and Tally connected until the initial sync completes.",
      );
    if (matches.length > 1)
      throw cacheError(
        "Multiple cached company GUIDs share this name. Select a uniquely named company in Tally.",
        409,
      );
    const cached = matches[0];
    const ledgers = db
      .prepare(
        "SELECT name,opening_cents FROM cache_ledgers WHERE dataset=? AND parent_group=? ORDER BY name",
      )
      .all(cached.dataset, input.group);
    if (!ledgers.length)
      throw cacheError(
        "Group not found or has no directly assigned ledgers in the last synced local snapshot.",
        404,
      );
    const rows = db
      .prepare(
        `SELECT e.ledger_name,SUM(e.debit_cents) AS debit_cents,SUM(e.credit_cents) AS credit_cents
      FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id
      JOIN cache_ledgers l ON l.dataset=e.dataset AND l.name=e.ledger_name
      WHERE e.dataset=? AND l.parent_group=? AND v.date>=? AND v.date<=?
      GROUP BY e.ledger_name`,
      )
      .all(cached.dataset, input.group, input.from_date, input.to_date);
    const movementByLedger = new Map(rows.map((row) => [row.ledger_name, row]));
    const openingRows = db
      .prepare(
        `SELECT e.ledger_name,SUM(e.debit_cents-e.credit_cents) AS movement
      FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id
      JOIN cache_ledgers l ON l.dataset=e.dataset AND l.name=e.ledger_name
      WHERE e.dataset=? AND l.parent_group=? AND v.date<? GROUP BY e.ledger_name`,
      )
      .all(cached.dataset, input.group, input.from_date);
    const priorByLedger = new Map(openingRows.map((row) => [row.ledger_name, row.movement]));
    let opening = 0;
    let debit = 0;
    let credit = 0;
    const ledgerSummaries = ledgers.map((ledger) => {
      const start = ledger.opening_cents + (priorByLedger.get(ledger.name) || 0);
      const movement = movementByLedger.get(ledger.name) || { debit_cents: 0, credit_cents: 0 };
      const end = start + movement.debit_cents - movement.credit_cents;
      opening += start;
      debit += movement.debit_cents;
      credit += movement.credit_cents;
      return {
        ledger_name: ledger.name,
        opening_balance: balance(start),
        total_debit: movement.debit_cents / 100,
        total_credit: movement.credit_cents / 100,
        closing_balance: balance(end),
      };
    });
    const closing = opening + debit - credit;
    const stale =
      !connected ||
      cached.sync_status === "failed" ||
      Date.now() - Date.parse(cached.last_synced_at) > 180_000;
    return {
      company: cached.name,
      company_details: JSON.parse(cached.company_details_json || "{}"),
      group: input.group,
      from_date: input.from_date,
      to_date: input.to_date,
      ledger_count: ledgerSummaries.length,
      opening_balance: balance(opening),
      total_debit: debit / 100,
      total_credit: credit / 100,
      closing_balance: balance(closing),
      ledgers: ledgerSummaries,
      source: "local_sqlite",
      last_synced_at: cached.last_synced_at,
      sync_status: syncing ? "syncing" : stale ? "stale" : "ready",
      is_stale: stale,
      ...(cached.sync_error ? { sync_error: cached.sync_error } : {}),
    };
  }

  function outstanding(scope, input, { syncing = false, connected = true } = {}) {
    const company = input.company;
    const cached = db
      .prepare(
        "SELECT * FROM cache_companies WHERE scope=? AND active=1 AND lower(name)=lower(?) ORDER BY last_synced_at DESC",
      )
      .get(scope, company);
    if (!cached?.last_synced_at)
      throw cacheError("Local ledger cache is not ready for this company.");
    const ledgerName = input.ledger_name;
    const asOf = input.to_date || new Date().toISOString().slice(0, 10);
    const rows = db
      .prepare(
        "SELECT v.date,v.voucher_no,v.voucher_type,e.bill_allocations_json FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id WHERE e.dataset=? AND e.ledger_name=? AND v.date<=?",
      )
      .all(cached.dataset, ledgerName, asOf);
    const bills = [];
    for (const row of rows)
      for (const bill of JSON.parse(row.bill_allocations_json || "[]"))
        bills.push({
          date: row.date,
          voucher_no: row.voucher_no,
          voucher_type: row.voucher_type,
          reference: bill.reference || bill.name || "-",
          type: bill.type || bill.bill_type || "New Ref",
          amount: Number(bill.amount || 0),
          direction: bill.direction || (Number(bill.amount || 0) < 0 ? "Dr" : "Cr"),
          due_date: bill.due_date || row.date,
        });
    const totalCents = bills.reduce(
      (sum, row) =>
        sum + Math.round(Math.abs(row.amount) * 100) * (row.direction === "Dr" ? 1 : -1),
      0,
    );
    return {
      company: cached.name,
      company_details: JSON.parse(cached.company_details_json || "{}"),
      ledger_name: ledgerName,
      from_date: input.from_date || null,
      as_of_date: asOf,
      bills,
      total: Math.abs(totalCents) / 100,
      total_direction: totalCents < 0 ? "Cr" : totalCents > 0 ? "Dr" : null,
      source: "local_sqlite",
      last_synced_at: cached.last_synced_at,
      sync_status: syncing ? "syncing" : "ready",
      is_stale: !connected,
    };
  }

  function resolveLedger(scope, input = {}) {
    const company = input.company;
    const matches = db
      .prepare(
        "SELECT * FROM cache_companies WHERE scope=? AND active=1 ORDER BY last_synced_at DESC",
      )
      .all(scope)
      .filter((row) => companyNameKey(row.name) === companyNameKey(company));
    if (!matches.length || !matches[0].last_synced_at)
      throw cacheError(
        "Local ledger cache is not ready for this company. Keep Connector and Tally connected until the initial sync completes.",
      );
    if (matches.length > 1)
      throw cacheError(
        "Multiple cached company GUIDs share this name. Select a uniquely named company in Tally.",
        409,
      );
    const cached = matches[0];
    const dealerCode = typeof input.dealer_code === "string" ? input.dealer_code.trim() : "";
    const ledgerName = typeof input.ledger_name === "string" ? input.ledger_name.trim() : "";
    if (dealerCode) {
      const rows = db
        .prepare(
          "SELECT name FROM cache_ledgers WHERE dataset=? AND lower(trim(dealer_code))=lower(trim(?)) ORDER BY name",
        )
        .all(cached.dataset, dealerCode);
      if (!rows.length)
        throw cacheError(
          `Ledger not found for dealer_code '${dealerCode}' in the selected Tally company.`,
          404,
        );
      if (rows.length > 1)
        throw cacheError(
          `Multiple ledgers use dealer_code '${dealerCode}' in the selected Tally company.`,
          409,
        );
      return { ledger_name: rows[0].name, dealer_code: dealerCode };
    }
    if (!ledgerName) throw cacheError("Party requires dealer_code or ledger_name.", 400);
    const row = db
      .prepare("SELECT name,dealer_code FROM cache_ledgers WHERE dataset=? AND name=?")
      .get(cached.dataset, ledgerName);
    if (!row) throw cacheError("Ledger not found in the last synced local snapshot.", 404);
    return { ledger_name: row.name, ...(row.dealer_code ? { dealer_code: row.dealer_code } : {}) };
  }
  return {
    begin,
    company,
    summary,
    listCompanies,
    signatures,
    incompleteDetails,
    ledgers,
    stageLedgers,
    stageVouchers,
    publish,
    fail,
    failScope,
    discard,
    statement,
    groupSummary,
    outstanding,
    resolveLedger,
    ...stockItems,
    close: () => db.close(),
  };
}
