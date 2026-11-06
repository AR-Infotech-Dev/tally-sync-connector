import { syncPeriodErrors } from "../../../../../shared/syncPeriod.js";
export function syncPayload(form) {
  const components = new Set(form.components);
  components.add("company");
  if (components.has("vouchers")) {
    components.add("ledgers");
    components.add("stock_items");
  }
  return {
    refresh_opening: form.refresh_opening === true,
    from_date: form.from_date,
    to_date: form.to_date,
    company_guid: form.company_guid,
    components: [...components],
    batch_size: Number(form.batch_size),
    delay_ms: Number(form.delay_ms),
  };
}
export function validateSync(form, companies) {
  const errors = syncPeriodErrors(form);
  if (!companies.some((row) => row.guid === form.company_guid))
    errors.company_guid = "Select an open company from this Tally connection.";
  if (![25, 50, 100].includes(Number(form.batch_size)))
    errors.batch_size = "Choose a supported batch size.";
  if (
    !Number.isInteger(Number(form.delay_ms)) ||
    Number(form.delay_ms) < 250 ||
    Number(form.delay_ms) > 5000
  )
    errors.delay_ms = "Enter 250–5000 milliseconds.";
  return errors;
}
export const categorySelection = (current, key, checked) => {
  const next = new Set(current);
  if (checked) next.add(key);
  else next.delete(key);
  if (next.has("vouchers")) {
    next.add("ledgers");
    next.add("stock_items");
  }
  next.add("company");
  return [...next];
};
import { syncCategories } from "../data/module.schema.js";
export const syncCategoryLabel = (key) =>
  syncCategories.find((row) => row.key === key)?.label || key;
