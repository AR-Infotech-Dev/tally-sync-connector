import { setTimeout as delay } from "node:timers/promises";

export async function* readSyncBatches(
  items,
  {
    read,
    signal,
    batchSize = 100,
    delayMs = 250,
    onResize = () => {},
    describe = (item) => `MasterID ${item.id || item}`,
  },
) {
  let completed = 0;
  while (completed < items.length) {
    signal.throwIfAborted();
    const batch = items.slice(completed, completed + batchSize);
    let rows;
    try {
      rows = await read(batch);
    } catch (cause) {
      signal.throwIfAborted();
      if (cause.code !== "TALLY_RESPONSE_TOO_LARGE") throw cause;
      if (batch.length === 1) {
        throw Object.assign(
          new Error(
            `${describe(batch[0])} exceeds the Tally response limit even when fetched alone. The previous complete SQLite snapshot is preserved.`,
            { cause },
          ),
          { code: cause.code, maxResponseBytes: cause.maxResponseBytes },
        );
      }
      batchSize = Math.max(1, Math.floor(batch.length / 2));
      onResize({ completed, batch_size: batchSize });
      if (delayMs) await delay(delayMs, undefined, { signal });
      continue;
    }
    signal.throwIfAborted();
    completed += batch.length;
    yield { rows, batch, completed, batchSize };
    if (delayMs) await delay(delayMs, undefined, { signal });
  }
}

export function splitSyncDateRange(fromDate, toDate) {
  if (fromDate >= toDate) return null;
  const asTime = (value) =>
    Date.parse(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  const day = 86400000;
  const middle = Math.floor((asTime(fromDate) + asTime(toDate)) / (2 * day)) * day;
  const asDate = (value) => new Date(value).toISOString().slice(0, 10).replaceAll("-", "");
  return [
    [fromDate, asDate(middle)],
    [asDate(middle + day), toDate],
  ];
}

/** Bound ordinary index reads to calendar months; retain all future-dated data in a tail range. */
export function initialManifestRanges(fromDate, toDate = "20991231", now = new Date()) {
  if (!/^\d{8}$/.test(fromDate || "") || !/^\d{8}$/.test(toDate) || fromDate > toDate)
    throw new Error("Invalid company date range for voucher indexing.");
  const asDate = (date) => date.toISOString().slice(0, 10).replaceAll("-", "");
  const currentMonthEnd = asDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
  );
  const historicalEnd = toDate < currentMonthEnd ? toDate : currentMonthEnd;
  const result = [];
  let start = fromDate;
  while (start <= historicalEnd) {
    const year = Number(start.slice(0, 4)),
      month = Number(start.slice(4, 6));
    const monthEnd = asDate(new Date(Date.UTC(year, month, 0)));
    const end = monthEnd < historicalEnd ? monthEnd : historicalEnd;
    result.push([start, end]);
    start = asDate(
      new Date(
        Date.parse(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`) + 86400000,
      ),
    );
  }
  if (start <= toDate) result.push([start, toDate]);
  return result;
}
