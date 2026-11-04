import { randomUUID, createHash } from "node:crypto";
import { syncPlanKey } from "../services/syncPlan.js";

export function createSyncCheckpointStore(db, transaction) {
  db.exec(`CREATE TABLE IF NOT EXISTS cache_sync_sessions (
    scope TEXT NOT NULL, guid TEXT NOT NULL, plan TEXT NOT NULL, stage TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL, master_hash TEXT, total INTEGER NOT NULL DEFAULT 0,
    batch_size INTEGER NOT NULL DEFAULT 100, error TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY(scope,guid,plan));
    CREATE TABLE IF NOT EXISTS cache_components (
      scope TEXT NOT NULL,guid TEXT NOT NULL,component TEXT NOT NULL,dataset TEXT NOT NULL,
      updated_at TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(scope,guid,component));
    CREATE TABLE IF NOT EXISTS cache_sync_master_rows(stage TEXT NOT NULL,object_type TEXT NOT NULL,id TEXT NOT NULL,signature TEXT NOT NULL,details_json TEXT NOT NULL,PRIMARY KEY(stage,object_type,id));
    CREATE TABLE IF NOT EXISTS cache_sync_range_plans(stage TEXT PRIMARY KEY,from_date TEXT NOT NULL,to_date TEXT NOT NULL,ranges_json TEXT NOT NULL);
    UPDATE cache_sync_sessions SET state='paused' WHERE state='syncing';`);
  function begin(scope, guid, options, batchSize = 100) {
    const { components, from_date, to_date } = options;
    const plan = syncPlanKey(options);
    const previous = db
      .prepare("SELECT * FROM cache_sync_sessions WHERE scope=? AND guid=? AND plan=?")
      .get(scope, guid, plan);
    const stage = previous?.stage || `stage:${randomUUID()}`;
    db.prepare(
      "INSERT INTO cache_sync_sessions(scope,guid,plan,stage,state,updated_at) VALUES(?,?,?,?,'syncing',?) ON CONFLICT(scope,guid,plan) DO UPDATE SET state='syncing',error=NULL,updated_at=excluded.updated_at",
    ).run(scope, guid, plan, stage, new Date().toISOString());
    db.prepare("UPDATE cache_sync_sessions SET batch_size=? WHERE stage=?").run(batchSize, stage);
    return { stage, plan, components, from_date, to_date };
  }
  function prepare(run, ledgers, stockItems, manifest, total) {
    const masterHash = createHash("sha256")
      .update(
        JSON.stringify([
          [...ledgers].sort((a, b) => a.name.localeCompare(b.name)),
          [...stockItems].sort((a, b) => a.name.localeCompare(b.name)),
        ]),
      )
      .digest("hex");
    transaction(() => {
      const previous = db
        .prepare("SELECT master_hash FROM cache_sync_sessions WHERE stage=?")
        .get(run.stage);
      if (previous?.master_hash && previous.master_hash !== masterHash)
        db.prepare("DELETE FROM cache_vouchers WHERE dataset=?").run(run.stage);
      db.prepare("DELETE FROM cache_manifest WHERE dataset=?").run(run.stage);
      const insert = db.prepare("INSERT INTO cache_manifest(dataset,id,signature) VALUES(?,?,?)");
      for (const row of manifest) insert.run(run.stage, row.id, row.signature);
      db.prepare(
        "DELETE FROM cache_vouchers WHERE dataset=? AND NOT EXISTS (SELECT 1 FROM cache_manifest m WHERE m.dataset=? AND m.id=cache_vouchers.id AND m.signature=cache_vouchers.signature)",
      ).run(run.stage, run.stage);
      db.prepare(
        "UPDATE cache_sync_sessions SET master_hash=?,total=?,updated_at=? WHERE stage=?",
      ).run(masterHash, total, new Date().toISOString(), run.stage);
    });
    return new Map(
      db
        .prepare("SELECT id,signature FROM cache_vouchers WHERE dataset=?")
        .all(run.stage)
        .map((row) => [row.id, row.signature]),
    );
  }
  function fail(run, error) {
    db.prepare("UPDATE cache_sync_sessions SET state=?,error=?,updated_at=? WHERE stage=?").run(
      error.code === "SYNC_PAUSED" ? "paused" : "failed",
      String(error.message).slice(0, 1000),
      new Date().toISOString(),
      run.stage,
    );
  }
  function complete(run) {
    db.prepare("DELETE FROM cache_sync_range_plans WHERE stage=?").run(run.stage);
    db.prepare("DELETE FROM cache_sync_master_rows WHERE stage=?").run(run.stage);
    db.prepare("DELETE FROM cache_sync_sessions WHERE stage=?").run(run.stage);
  }
  function manifestPlan(run, from, to) {
    const row = db
      .prepare(
        "SELECT ranges_json FROM cache_sync_range_plans WHERE stage=? AND from_date=? AND to_date=?",
      )
      .get(run.stage, from, to);
    return row ? JSON.parse(row.ranges_json) : null;
  }
  function saveManifestPlan(run, from, to, ranges) {
    db.prepare(
      "INSERT INTO cache_sync_range_plans VALUES(?,?,?,?) ON CONFLICT(stage) DO UPDATE SET from_date=excluded.from_date,to_date=excluded.to_date,ranges_json=excluded.ranges_json",
    ).run(run.stage, from, to, JSON.stringify(ranges));
  }
  function masterRows(run, type) {
    return new Map(
      db
        .prepare(
          "SELECT id,signature,details_json FROM cache_sync_master_rows WHERE stage=? AND object_type=?",
        )
        .all(run.stage, type)
        .map((row) => [row.id, { signature: row.signature, row: JSON.parse(row.details_json) }]),
    );
  }
  function saveMasterRows(run, type, rows) {
    transaction(() => {
      const insert = db.prepare("INSERT OR REPLACE INTO cache_sync_master_rows VALUES(?,?,?,?,?)");
      for (const row of rows)
        insert.run(run.stage, type, row.id, row.signature, JSON.stringify(row.row));
      db.prepare("UPDATE cache_sync_sessions SET updated_at=? WHERE stage=?").run(
        new Date().toISOString(),
        run.stage,
      );
    });
  }
  function component(scope, guid, key) {
    return db
      .prepare("SELECT * FROM cache_components WHERE scope=? AND guid=? AND component=?")
      .get(scope, guid, key);
  }
  function ready(run, key, dataset, details = {}) {
    db.prepare(
      "INSERT INTO cache_components(scope,guid,component,dataset,updated_at,details_json) VALUES(?,?,?,?,?,?) ON CONFLICT(scope,guid,component) DO UPDATE SET dataset=excluded.dataset,updated_at=excluded.updated_at,details_json=excluded.details_json",
    ).run(run.scope, run.guid, key, dataset, new Date().toISOString(), JSON.stringify(details));
  }
  function status(scope) {
    return {
      checkpoints: db
        .prepare(
          "SELECT s.*,c.name AS company,c.sync_status AS company_sync_status,(SELECT COUNT(*) FROM cache_vouchers v WHERE v.dataset=s.stage) AS saved_vouchers,(SELECT COUNT(*) FROM cache_entries e WHERE e.dataset=s.stage) AS saved_entries,(SELECT COUNT(*) FROM cache_sync_master_rows m WHERE m.stage=s.stage AND m.object_type IN ('Ledger','StockItem')) AS saved_masters FROM cache_sync_sessions s JOIN cache_companies c ON c.scope=s.scope AND c.guid=s.guid WHERE s.scope=? ORDER BY s.updated_at DESC",
        )
        .all(scope)
        .map(({ master_hash, ...row }) => {
          const saved = JSON.parse(row.plan);
          return { ...row, ...(Array.isArray(saved) ? { components: saved } : saved) };
        }),
      components: db
        .prepare(
          "SELECT guid,component,updated_at,details_json,CASE component WHEN 'ledgers' THEN (SELECT COUNT(*) FROM cache_ledgers WHERE dataset=c.dataset) WHEN 'stock_items' THEN (SELECT COUNT(*) FROM cache_stock_items WHERE dataset=c.dataset) WHEN 'vouchers' THEN (SELECT COUNT(*) FROM cache_vouchers WHERE dataset=c.dataset) ELSE 1 END AS record_count FROM cache_components c WHERE scope=?",
        )
        .all(scope)
        .map(({ details_json, ...row }) => ({ ...row, ...JSON.parse(details_json || "{}") })),
    };
  }
  return {
    manifestPlan,
    saveManifestPlan,
    begin,
    prepare,
    fail,
    complete,
    component,
    ready,
    status,
    masterRows,
    saveMasterRows,
  };
}
