import { currentFinancialYear } from "../../../../../shared/syncPeriod.js";
export const syncCategories = [
  { key: "company", label: "Company details", hint: "Name, address and contact information." },
  {
    key: "ledgers",
    label: "Ledger masters",
    hint: "Ledgers, parent groups, opening balances and Dealer Codes.",
  },
  {
    key: "stock_items",
    label: "Stock item masters",
    hint: "Stock items and Item Codes / Part Numbers.",
  },
  {
    key: "vouchers",
    label: "Vouchers",
    hint: "Accounting entries, inventory and bill allocations. Includes the required masters.",
  },
];
export const initialSyncValues = {
  ...currentFinancialYear(),
  company_guid: "",
  components: syncCategories.map((row) => row.key),
  batch_size: 100,
  delay_ms: 500,
};
export const batchSizes = [25, 50, 100];
