import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { companyNameKey } from "../utils/companyName.js";

export const cacheScope = (config) => createHash("sha256").update(JSON.stringify([config.serverUrl.replace(/\/+$/, ""), config.clientId, config.tallyUrl.replace(/\/+$/, "")])).digest("hex");
const balance = (value) => ({ amount: Math.abs(value) / 100, type: value > 0 ? "Dr" : value < 0 ? "Cr" : null });
const cacheError = (message, status = 503) => Object.assign(new Error(message), { httpStatus: status });

export function createLedgerCache(filePath) {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS cache_companies (
      scope TEXT NOT NULL, guid TEXT NOT NULL, name TEXT NOT NULL, dataset TEXT NOT NULL,
      last_synced_at TEXT, last_attempt_at TEXT, sync_status TEXT NOT NULL DEFAULT 'pending', sync_error TEXT, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(scope,guid));
    CREATE INDEX IF NOT EXISTS cache_company_name ON cache_companies(scope,name);
    CREATE TABLE IF NOT EXISTS cache_ledgers(dataset TEXT NOT NULL,name TEXT NOT NULL,master_id TEXT NOT NULL,guid TEXT NOT NULL,opening_cents INTEGER NOT NULL,PRIMARY KEY(dataset,name));
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
  if (!companyColumns.some((column) => column.name === "active")) db.exec("ALTER TABLE cache_companies ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  db.exec("PRAGMA user_version=2");
  // Only unpublished staging rows belong to interrupted local sync attempts.
  db.exec("DELETE FROM cache_entries WHERE dataset LIKE 'stage:%'; DELETE FROM cache_vouchers WHERE dataset LIKE 'stage:%'; DELETE FROM cache_ledgers WHERE dataset LIKE 'stage:%'; DELETE FROM cache_manifest WHERE dataset LIKE 'stage:%';");

  function transaction(callback) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = callback(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function company(scope, guid) { return db.prepare("SELECT * FROM cache_companies WHERE scope=? AND guid=?").get(scope, guid); }
  function summary(scope, name) {
    const rows = db.prepare(`SELECT c.name,c.last_synced_at,c.sync_status,c.sync_error,
      (SELECT COUNT(*) FROM cache_ledgers WHERE dataset=c.dataset) AS ledgers,
      (SELECT COUNT(*) FROM cache_vouchers WHERE dataset=c.dataset) AS vouchers,
      (SELECT COUNT(*) FROM cache_entries WHERE dataset=c.dataset) AS entries
      FROM cache_companies c WHERE c.scope=? AND c.active=1 ORDER BY c.name`).all(scope).filter((row) => !name || companyNameKey(row.name) === companyNameKey(name));
    return { companies: rows, cached_ledgers: rows.reduce((sum, row) => sum + row.ledgers, 0), cached_vouchers: rows.reduce((sum, row) => sum + row.vouchers, 0), cached_entries: rows.reduce((sum, row) => sum + row.entries, 0) };
  }
  function failScope(scope, error) {
    db.prepare("UPDATE cache_companies SET sync_status='failed',sync_error=?,last_attempt_at=? WHERE scope=?").run(String(error.message || error).slice(0, 500), new Date().toISOString(), scope);
  }
  function begin(scope, identity) {
    const dataset = `live:${scope}:${identity.guid}`;
    const stage = `stage:${randomUUID()}`;
    db.prepare("INSERT INTO cache_companies(scope,guid,name,dataset,last_attempt_at,sync_status,active) VALUES(?,?,?,?,?,'syncing',0) ON CONFLICT(scope,guid) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,sync_status='syncing',sync_error=NULL").run(scope, identity.guid, identity.name, dataset, new Date().toISOString());
    return { scope, ...identity, dataset, stage };
  }
  function signatures(run) { return new Map(db.prepare("SELECT id,signature FROM cache_vouchers WHERE dataset=?").all(run.dataset).map((row) => [row.id, row.signature])); }
  function ledgers(run) { return db.prepare("SELECT name,master_id,guid,opening_cents FROM cache_ledgers WHERE dataset=? ORDER BY name").all(run.dataset); }
  function stageLedgers(run, rows) {
    const insert = db.prepare("INSERT INTO cache_ledgers VALUES(?,?,?,?,?)");
    transaction(() => { for (const row of rows) insert.run(run.stage, row.name, row.master_id, row.guid, row.opening_cents); });
  }
  function stageVouchers(run, rows) {
    const voucher = db.prepare("INSERT INTO cache_vouchers VALUES(?,?,?,?,?,?,?,?)");
    const entry = db.prepare("INSERT INTO cache_entries VALUES(?,?,?,?,?,?)");
    transaction(() => {
      for (const row of rows) {
        voucher.run(run.stage, row.id, row.alter_id, row.signature, row.date, row.voucher_no, row.voucher_type, row.narration);
        for (const allocation of row.entries) entry.run(run.stage, row.id, allocation.ledger_name, allocation.debit_cents, allocation.credit_cents, JSON.stringify(allocation.particulars));
      }
    });
  }
  function discard(run) {
    transaction(() => {
      db.prepare("DELETE FROM cache_vouchers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_manifest WHERE dataset=?").run(run.stage);
    });
  }
  function fail(run, error) {
    discard(run);
    db.prepare("UPDATE cache_companies SET sync_status='failed',sync_error=? WHERE scope=? AND guid=?").run(String(error.message || error).slice(0, 500), run.scope, run.guid);
  }
  function publish(run, manifest) {
    const now = new Date().toISOString();
    transaction(() => {
      const insert = db.prepare("INSERT INTO cache_manifest VALUES(?,?,?)");
      for (const row of manifest) insert.run(run.stage, row.id, row.signature);
      // Delete disappeared, cancelled/replaced and changed versions atomically;
      // cascading removes the old ledger allocations before replacement.
      db.prepare("DELETE FROM cache_vouchers WHERE dataset=? AND (id NOT IN (SELECT id FROM cache_manifest WHERE dataset=?) OR id IN (SELECT id FROM cache_vouchers WHERE dataset=?))").run(run.dataset, run.stage, run.stage);
      db.prepare("INSERT INTO cache_vouchers SELECT ?,id,alter_id,signature,date,voucher_no,voucher_type,narration FROM cache_vouchers WHERE dataset=?").run(run.dataset, run.stage);
      db.prepare("INSERT INTO cache_entries SELECT ?,voucher_id,ledger_name,debit_cents,credit_cents,particulars FROM cache_entries WHERE dataset=?").run(run.dataset, run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.dataset);
      db.prepare("INSERT INTO cache_ledgers SELECT ?,name,master_id,guid,opening_cents FROM cache_ledgers WHERE dataset=?").run(run.dataset, run.stage);
      const previousNames = db.prepare("SELECT guid,name FROM cache_companies WHERE scope=? AND guid<>?").all(run.scope, run.guid);
      for (const previous of previousNames.filter((row) => companyNameKey(row.name) === companyNameKey(run.name))) db.prepare("UPDATE cache_companies SET active=0 WHERE scope=? AND guid=?").run(run.scope, previous.guid);
      db.prepare("UPDATE cache_companies SET name=?,last_synced_at=?,sync_status='ready',sync_error=NULL,active=1 WHERE scope=? AND guid=?").run(run.name, now, run.scope, run.guid);
      db.prepare("DELETE FROM cache_vouchers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_ledgers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_manifest WHERE dataset=?").run(run.stage);
    });
    return now;
  }
  function statement(scope, input, { syncing = false, connected = true } = {}) {
    const matches = db.prepare("SELECT * FROM cache_companies WHERE scope=? AND active=1 ORDER BY last_synced_at DESC").all(scope).filter((row) => companyNameKey(row.name) === companyNameKey(input.company));
    if (!matches.length || !matches[0].last_synced_at) throw cacheError("Local ledger cache is not ready for this company. Keep Connector and Tally connected until the initial sync completes.");
    if (matches.length > 1) throw cacheError("Multiple cached company GUIDs share this name. Select a uniquely named company in Tally.", 409);
    const cached = matches[0];
    const ledger = db.prepare("SELECT * FROM cache_ledgers WHERE dataset=? AND name=?").get(cached.dataset, input.ledger_name);
    if (!ledger) throw cacheError("Ledger not found in the last synced local snapshot.", 404);
    const prior = db.prepare("SELECT COALESCE(SUM(e.debit_cents-e.credit_cents),0) AS movement FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id WHERE e.dataset=? AND e.ledger_name=? AND v.date<?").get(cached.dataset, input.ledger_name, input.from_date);
    const opening = ledger.opening_cents + prior.movement;
    let running = opening; let debit = 0; let credit = 0;
    const rows = db.prepare("SELECT v.*,e.debit_cents,e.credit_cents,e.particulars FROM cache_entries e JOIN cache_vouchers v ON e.dataset=v.dataset AND e.voucher_id=v.id WHERE e.dataset=? AND e.ledger_name=? AND v.date>=? AND v.date<=? AND (e.debit_cents<>0 OR e.credit_cents<>0) ORDER BY v.date,CAST(v.id AS INTEGER)").all(cached.dataset, input.ledger_name, input.from_date, input.to_date);
    const entries = rows.map((row) => {
      running += row.debit_cents - row.credit_cents; debit += row.debit_cents; credit += row.credit_cents;
      return { date: row.date, voucher_no: row.voucher_no, voucher_type: row.voucher_type, master_id: row.id, narration: row.narration, particulars: JSON.parse(row.particulars), debit: row.debit_cents / 100, credit: row.credit_cents / 100, balance: balance(running) };
    });
    const stale = !connected || cached.sync_status === "failed" || Date.now() - Date.parse(cached.last_synced_at) > 180_000;
    return {
      company: cached.name, ledger_name: input.ledger_name, from_date: input.from_date, to_date: input.to_date,
      opening_balance: balance(opening), entries, total_debit: debit / 100, total_credit: credit / 100, closing_balance: balance(running),
      source: "local_sqlite", last_synced_at: cached.last_synced_at, sync_status: syncing ? "syncing" : stale ? "stale" : "ready", is_stale: stale,
      ...(cached.sync_error ? { sync_error: cached.sync_error } : {})
    };
  }
  return { begin, company, summary, signatures, ledgers, stageLedgers, stageVouchers, publish, fail, failScope, discard, statement, close: () => db.close() };
}
