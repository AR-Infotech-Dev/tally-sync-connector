import { children, field, nameOf, cents } from "./statement.js";

/** Preserve voucher detail separately from ledger movements; never sum it twice. */
export function inventoryDetails(voucher) {
  const all = children(voucher).filter(node => nameOf(node) === "ALLINVENTORYENTRIES.LIST" && field(node, "STOCKITEMNAME"));
  const rows = all.length ? all : children(voucher).filter(node => ["INVENTORYENTRIES.LIST", "INVENTORYENTRIESIN.LIST", "INVENTORYENTRIESOUT.LIST"].includes(nameOf(node)) && field(node, "STOCKITEMNAME"));
  return rows.map(node => ({
    stock_item: field(node, "STOCKITEMNAME"), quantity: field(node, "BILLEDQTY") || field(node, "ACTUALQTY"),
    rate: field(node, "RATE"), amount: cents(field(node, "AMOUNT")) / 100,
  }));
}

export function billDetails(allocation) {
  return children(allocation).filter(node => nameOf(node) === "BILLALLOCATIONS.LIST" && field(node, "AMOUNT")).map(node => {
    const amount = field(node, "AMOUNT");
    return { reference: field(node, "NAME"), type: field(node, "BILLTYPE"), amount: cents(amount) / 100,
      direction: Number(amount.replaceAll(",", "")) < 0 ? "Dr" : "Cr" };
  });
}

export function companyDetails(company) {
  const address = children(company).filter(node => nameOf(node) === "ADDRESS.LIST")
    .flatMap(list => children(list).filter(node => nameOf(node) === "ADDRESS").map(node => node.textContent.trim())).filter(Boolean);
  return { address, pincode: field(company, "PINCODE"), email: field(company, "EMAIL") };
}

/** Descriptive bank metadata never changes statement totals. */
export function bankDetails(allocations) {
  return allocations.flatMap(allocation => children(allocation)
    .filter(node => nameOf(node) === "BANKALLOCATIONS.LIST")
    .map(node => ({
      transaction_type: field(node, "TRANSACTIONTYPE"),
      bank_name: field(node, "BANKNAME") || field(allocation, "LEDGERNAME"),
      instrument_number: field(node, "INSTRUMENTNUMBER"),
      instrument_date: field(node, "INSTRUMENTDATE"),
      status: field(node, "STATUS") || field(node, "BANKSTATUS"),
    })));
}
