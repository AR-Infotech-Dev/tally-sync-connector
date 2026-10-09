import fs from "node:fs";
import path from "node:path";

const MAX_LOG_ENTRIES = 5000;

/** Persists recent connector activity as newline-delimited JSON in Electron userData. */
export function createActivityLogStore(directory) {
  const filePath = path.join(directory, "connector-activity.jsonl");

  function readAll() {
    try {
      return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
    } catch { return []; }
  }

  function append(entry, retentionDays = 30) {
    fs.mkdirSync(directory, { recursive: true });
    const cutoff = Date.now() - Math.max(1, Number(retentionDays) || 30) * 86400000;
    const entries = [...readAll(), entry].filter((item) => new Date(item.at).getTime() >= cutoff).slice(-MAX_LOG_ENTRIES);
    fs.writeFileSync(filePath, entries.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  }

  function list({ limit = 500, search = "", level = "all" } = {}) {
    const query = String(search).trim().toLowerCase();
    return readAll().filter((entry) => {
      const entryLevel = entry.status === "failed" ? "error" : entry.status === "succeeded" ? "success" : "info";
      const matchesLevel = level === "all" || entryLevel === level;
      const matchesQuery = !query || `${entry.requestId} ${entry.status} ${entry.message}`.toLowerCase().includes(query);
      return matchesLevel && matchesQuery;
    }).slice(-Math.min(MAX_LOG_ENTRIES, Math.max(1, Number(limit) || 500))).reverse();
  }

  function clear() {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(filePath, "", "utf8");
    return true;
  }

  return Object.freeze({ append, list, clear });
}
