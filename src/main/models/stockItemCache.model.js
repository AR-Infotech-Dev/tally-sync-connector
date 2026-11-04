import { companyNameKey } from "../utils/companyName.js";

const codeKey = (value) => String(value).normalize("NFKC").trim().toLocaleLowerCase("en-IN");
const itemError = (message, httpStatus, code) =>
  Object.assign(new Error(message), { httpStatus, code });

export function createStockItemCache(db, transaction) {
  db.exec(`CREATE TABLE IF NOT EXISTS cache_stock_items (
    dataset TEXT NOT NULL, name TEXT NOT NULL, item_code TEXT NOT NULL DEFAULT '',
    part_numbers_json TEXT NOT NULL DEFAULT '[]', master_id TEXT NOT NULL DEFAULT '', guid TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(dataset,name));
    CREATE TABLE IF NOT EXISTS cache_stock_item_codes (
      dataset TEXT NOT NULL, item_name TEXT NOT NULL, item_code TEXT NOT NULL, code_key TEXT NOT NULL,
      PRIMARY KEY(dataset,item_name,code_key),
      FOREIGN KEY(dataset,item_name) REFERENCES cache_stock_items(dataset,name) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS cache_stock_code_lookup ON cache_stock_item_codes(dataset,code_key);
`);

  function stageStockItems(run, rows) {
    const item = db.prepare(
      "INSERT INTO cache_stock_items(dataset,name,item_code,part_numbers_json,master_id,guid) VALUES(?,?,?,?,?,?)",
    );
    const code = db.prepare(
      "INSERT INTO cache_stock_item_codes(dataset,item_name,item_code,code_key) VALUES(?,?,?,?)",
    );
    transaction(() => {
      db.prepare("DELETE FROM cache_stock_items WHERE dataset=?").run(run.stage);
      for (const row of rows) {
        const numbers = [
          ...new Map(
            (row.part_numbers || []).map((value) => [codeKey(value), String(value).trim()]),
          ).values(),
        ].filter(Boolean);
        item.run(
          run.stage,
          row.name,
          numbers[0] || "",
          JSON.stringify(numbers),
          row.master_id || "",
          row.guid || "",
        );
        for (const number of numbers) code.run(run.stage, row.name, number, codeKey(number));
      }
    });
  }
  // Called inside the ledger cache publication transaction, preserving one complete company snapshot.
  function publishStockItems(run, { keepStage = false } = {}) {
    db.prepare("DELETE FROM cache_stock_items WHERE dataset=?").run(run.dataset);
    db.prepare(
      "INSERT INTO cache_stock_items SELECT ?,name,item_code,part_numbers_json,master_id,guid FROM cache_stock_items WHERE dataset=?",
    ).run(run.dataset, run.stage);
    db.prepare(
      "INSERT INTO cache_stock_item_codes SELECT ?,item_name,item_code,code_key FROM cache_stock_item_codes WHERE dataset=?",
    ).run(run.dataset, run.stage);
    if (!keepStage) discardStockItems(run);
  }
  function discardStockItems(run) {
    db.prepare("DELETE FROM cache_stock_items WHERE dataset=?").run(run.stage);
  }

  function resolveStockItem(scope, input = {}) {
    const supplied = input.item_code;
    if (
      supplied !== undefined &&
      (typeof supplied !== "string" ||
        !supplied.trim() ||
        supplied.length > 500 ||
        /[\x00-\x1f]/.test(supplied))
    )
      throw itemError(
        "item_code must be a non-empty string up to 500 characters.",
        400,
        "INVALID_ITEM_CODE",
      );
    if (supplied === undefined) {
      const name = input.stock_item || input.item_name || input.name;
      if (typeof name !== "string" || !name.trim())
        throw itemError("Item requires item_code or stock_item.", 400, "ITEM_IDENTITY_REQUIRED");
      return { stock_item: name };
    }
    const matches = db
      .prepare("SELECT guid,name,dataset,last_synced_at,active FROM cache_companies WHERE scope=?")
      .all(scope)
      .filter((row) =>
        input.company_guid
          ? row.guid.toLowerCase() === input.company_guid.toLowerCase()
          : companyNameKey(row.name) === companyNameKey(input.company),
      )
      .map((row) => {
        const master = db
          .prepare(
            "SELECT dataset,updated_at FROM cache_components WHERE scope=? AND guid=? AND component='stock_items'",
          )
          .get(scope, row.guid);
        return master
          ? { ...row, dataset: master.dataset, last_synced_at: master.updated_at }
          : row.active
            ? row
            : { ...row, last_synced_at: null };
      });
    if (!matches.length || !matches[0].last_synced_at)
      throw itemError(
        "Stock item cache is not ready for this company. Complete a company sync.",
        503,
        "ITEM_CACHE_NOT_READY",
      );
    if (matches.length > 1)
      throw itemError("Multiple company GUIDs share this company name.", 409, "COMPANY_AMBIGUOUS");
    const items = db
      .prepare(
        "SELECT item_name FROM cache_stock_item_codes WHERE dataset=? AND code_key=? ORDER BY item_name",
      )
      .all(matches[0].dataset, codeKey(supplied));
    if (!items.length)
      throw itemError(
        `Stock item not found for item_code '${supplied.trim()}' in the selected Tally company. Complete a sync after updating Part No.`,
        404,
        "ITEM_CODE_NOT_FOUND",
      );
    if (items.length > 1)
      throw itemError(
        `Multiple stock items use item_code '${supplied.trim()}' in the selected Tally company.`,
        409,
        "ITEM_CODE_AMBIGUOUS",
      );
    return { stock_item: items[0].item_name, item_code: supplied.trim() };
  }
  return { stageStockItems, publishStockItems, discardStockItems, resolveStockItem };
}
