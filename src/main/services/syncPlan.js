import { currentFinancialYear, syncPeriodErrors } from "../../shared/syncPeriod.js";
export const SYNC_COMPONENTS = ["company", "ledgers", "stock_items", "vouchers"];
export const syncPlanKey = (plan) =>
  JSON.stringify({ components: plan.components, from_date: plan.from_date, to_date: plan.to_date });
export function normalizeSyncPlan(input = {}) {
  const defaults = currentFinancialYear();
  const period = {
    from_date: input.from_date ?? defaults.from_date,
    to_date: input.to_date ?? defaults.to_date,
  };
  const errors = syncPeriodErrors(period);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const selected = input.components ?? SYNC_COMPONENTS;
  if (
    !Array.isArray(selected) ||
    !selected.length ||
    selected.some((key) => !SYNC_COMPONENTS.includes(key))
  )
    throw new Error("Select at least one supported sync category.");
  const components = new Set(selected);
  components.add("company");
  // A complete accounting snapshot includes the masters used by its allocations.
  if (components.has("vouchers")) {
    components.add("ledgers");
    components.add("stock_items");
  }
  const batchSize = Number(input.batch_size ?? 100);
  const delayMs = Number(input.delay_ms ?? 500);
  if (![25, 50, 100].includes(batchSize)) throw new Error("Batch size must be 25, 50 or 100.");
  if (!Number.isInteger(delayMs) || delayMs < 250 || delayMs > 5000)
    throw new Error("Batch delay must be between 250 and 5000 milliseconds.");
  return {
    ...period,
    components: SYNC_COMPONENTS.filter((key) => components.has(key)),
    batch_size: batchSize,
    delay_ms: delayMs,
  };
}
