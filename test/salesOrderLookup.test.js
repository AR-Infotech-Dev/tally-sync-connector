import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesOrderSearchRequest, parseSalesOrderSearchResponse, buildSalesOrderObjectRequest, parseSalesOrderObjectResponse } from "../src/main/utils/tally-connector-engine/salesOrderLookup.js";
import { buildSalesVoucherSearchRequest } from "../src/main/utils/tally-connector-engine/salesVoucherLookup.js";

const lookup = { company: "Sai & Sons", ledger_name: 'A "Traders"', voucher_no: "SO/0031", voucher_date: "2026-10-23" };

test("Sales Order lookup is type-specific and escapes caller values", () => {
  const xml = buildSalesOrderSearchRequest(lookup);
  assert.ok(xml.includes("$$IsSalesOrder:$VoucherTypeName"));
  assert.ok(xml.includes("Sai &amp; Sons"));
  assert.ok(xml.includes("A &quot;Traders&quot;"));
  assert.ok(xml.includes("SO/0031"));
  assert.ok(xml.includes("20261023"));
  assert.ok(buildSalesVoucherSearchRequest(lookup).includes("$$IsSales:$VoucherTypeName"));
});

test("Lookup refuses missing or ambiguous vouchers and malformed upstream replies", () => {
  assert.equal(parseSalesOrderSearchResponse("<COLLECTION><MASTERID>91</MASTERID></COLLECTION>"), "91");
  assert.throws(() => parseSalesOrderSearchResponse("<COLLECTION/>"), { httpStatus: 404 });
  assert.throws(() => parseSalesOrderSearchResponse("<COLLECTION><MASTERID>91</MASTERID><MASTERID>92</MASTERID></COLLECTION>"), { httpStatus: 409 });
  assert.throws(() => parseSalesOrderSearchResponse("<ENVELOPE/>"), /no collection/);
  assert.throws(() => parseSalesOrderSearchResponse("<LINEERROR>Company closed</LINEERROR>"), /rejected/);
  assert.throws(() => parseSalesOrderSearchResponse("<COLLECTION/>", "Sales Voucher"), { httpStatus: 404, message: "Sales Voucher not found in Tally for the supplied company, ledger_name and voucher_no." });
});

test("Object export is read-only and preserves nested voucher data", () => {
  const request = buildSalesOrderObjectRequest(lookup.company, "91");
  assert.ok(request.includes("<TALLYREQUEST>Export</TALLYREQUEST>"));
  assert.ok(request.includes('ID:91'));
  assert.throws(() => buildSalesOrderObjectRequest(lookup.company, '91</ID>'), /Invalid/);
  const response = '<ENVELOPE><VOUCHER><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item A</STOCKITEMNAME></ALLINVENTORYENTRIES.LIST></VOUCHER></ENVELOPE>';
  const voucher = parseSalesOrderObjectResponse(response, lookup);
  assert.deepEqual(voucher.details.allinventoryentries, [{ stockitemname: "Item A" }]);
  assert.equal(Object.hasOwn(voucher, "voucher_xml"), false);
  assert.throws(() => parseSalesOrderObjectResponse('<ENVELOPE/>', lookup), /returned 0 voucher/);
});
