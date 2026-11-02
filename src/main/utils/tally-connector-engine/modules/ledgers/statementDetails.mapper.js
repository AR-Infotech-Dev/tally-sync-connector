import { children, field, nameOf, cents } from "./statement.js";

/** Preserve voucher detail separately from ledger movements; never sum it twice. */
export function inventoryDetails(voucher) {
  const all = children(voucher).filter(
    (node) => nameOf(node) === "ALLINVENTORYENTRIES.LIST" && field(node, "STOCKITEMNAME"),
  );
  const rows = all.length
    ? all
    : children(voucher).filter(
        (node) =>
          ["INVENTORYENTRIES.LIST", "INVENTORYENTRIESIN.LIST", "INVENTORYENTRIESOUT.LIST"].includes(
            nameOf(node),
          ) && field(node, "STOCKITEMNAME"),
      );
  return rows.map((node) => ({
    stock_item: field(node, "STOCKITEMNAME"),
    quantity: field(node, "BILLEDQTY") || field(node, "ACTUALQTY"),
    rate: field(node, "RATE"),
    amount: cents(field(node, "AMOUNT")) / 100,
  }));
}

export function billDetails(allocation) {
  return children(allocation)
    .filter((node) => nameOf(node) === "BILLALLOCATIONS.LIST" && field(node, "AMOUNT"))
    .map((node) => {
      const amount = field(node, "AMOUNT");
      return {
        reference: field(node, "NAME"),
        type: field(node, "BILLTYPE"),
        amount: cents(amount) / 100,
        due_date:
          field(node, "DUEDATE") ||
          field(node, "BILLDUEDATE") ||
          field(node, "BILLCREDITPERIOD") ||
          null,
        direction: Number(amount.replaceAll(",", "")) < 0 ? "Dr" : "Cr",
      };
    });
}

export function companyDetails(company) {
  const addressNodes = [];
  const collect = (node) => {
    for (const child of children(node)) {
      if (nameOf(child) === "ADDRESS") addressNodes.push(child.textContent.trim());
      else if (["ADDRESS.LIST", "MAILINGADDRESS.LIST"].includes(nameOf(child))) collect(child);
    }
  };
  collect(company);
  const exportedLines = Array.from({ length: 10 }, (_, index) =>
    field(company, `FLOWUPSADDRESS${index + 1}`),
  ).filter(Boolean);
  const address = [
    ...new Set((exportedLines.length ? exportedLines : addressNodes).filter(Boolean)),
  ];
  return {
    address,
    pincode: field(company, "PINCODE"),
    email: field(company, "EMAIL"),
    phone:
      field(company, "PHONENUMBER") ||
      field(company, "MOBILENUMBER") ||
      field(company, "COMPANYCONTACTNUMBER"),
  };
}

/** Descriptive bank metadata never changes statement totals. */
export function bankDetails(allocations) {
  return allocations.flatMap((allocation) =>
    children(allocation)
      .filter((node) => nameOf(node) === "BANKALLOCATIONS.LIST")
      .map((node) => ({
        transaction_type: field(node, "TRANSACTIONTYPE"),
        bank_name: field(node, "BANKNAME") || field(allocation, "LEDGERNAME"),
        instrument_number: field(node, "INSTRUMENTNUMBER"),
        instrument_date: field(node, "INSTRUMENTDATE"),
        status: field(node, "STATUS") || field(node, "BANKSTATUS"),
      })),
  );
}
