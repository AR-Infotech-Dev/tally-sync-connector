import test from "node:test";
import assert from "node:assert/strict";
import { parseVoucherJson } from "../src/main/utils/tally-connector-engine/shared/parsers/voucherJson.js";

test("Voucher JSON preserves allocations, repeated entries, attributes and entity text", () => {
  const result = parseVoucherJson(`<ENVELOPE><VOUCHER VCHTYPE="Sales New"><VOUCHERNUMBER>0044</VOUCHERNUMBER><PARTYLEDGERNAME>A &amp; B</PARTYLEDGERNAME><NARRATION><![CDATA[Note <ready>]]></NARRATION><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item A</STOCKITEMNAME><AMOUNT>250.00</AMOUNT><BATCHALLOCATIONS.LIST><BATCHNAME>Main</BATCHNAME></BATCHALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST><ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>Item B</STOCKITEMNAME></ALLINVENTORYENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME></ALLLEDGERENTRIES.LIST><EMPTY/></VOUCHER></ENVELOPE>`);
  assert.equal(result.vouchernumber, "0044");
  assert.equal(result.partyledgername, "A & B");
  assert.equal(result.narration, "Note <ready>");
  assert.equal(result._attributes.VCHTYPE, "Sales New");
  assert.equal(result.allinventoryentries.length, 2);
  assert.equal(result.allinventoryentries[0].amount, "250.00");
  assert.deepEqual(result.allinventoryentries[0].batchallocations, [{ batchname: "Main" }]);
  assert.deepEqual(result.allledgerentries, [{ ledgername: "Sales" }]);
  assert.equal(result.empty, "");
});

test("Malformed and ambiguous exports fail instead of returning incomplete JSON", () => {
  for (const xml of ['<VOUCHER><NAME>broken</VOUCHER>', '<ENVELOPE/>', '<ENVELOPE><VOUCHER/><VOUCHER/></ENVELOPE>', '<!DOCTYPE VOUCHER [<!ENTITY test "value">]><VOUCHER/>', '<ENVELOPE><ERROR>Failed</ERROR><VOUCHER/></ENVELOPE>']) {
    assert.throws(() => parseVoucherJson(xml));
  }
});

test("Untrusted XML field names do not modify object prototypes", () => {
  const result = parseVoucherJson('<VOUCHER><__proto__><POLLUTED>yes</POLLUTED></__proto__></VOUCHER>');
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal({}.polluted, undefined);
});

test("Object exports accept mixed case and namespace-prefixed voucher tags", () => {
  assert.equal(parseVoucherJson('<Envelope><Voucher><VoucherNumber>44</VoucherNumber></Voucher></Envelope>').vouchernumber, '44');
  assert.equal(parseVoucherJson('<t:Envelope xmlns:t="urn:tally"><t:Voucher><VoucherNumber>44</VoucherNumber></t:Voucher></t:Envelope>').vouchernumber, '44');
});

test("Nested voucher references do not become separate exported records", () => {
  const result = parseVoucherJson('<ENVELOPE><VOUCHER><VOUCHERNUMBER>44</VOUCHERNUMBER><REFERENCES.LIST><VOUCHER><MASTERID>1</MASTERID></VOUCHER></REFERENCES.LIST></VOUCHER></ENVELOPE>');
  assert.equal(result.vouchernumber, '44');
  assert.equal(result.references[0].voucher.masterid, '1');
  assert.throws(() => parseVoucherJson('<ENVELOPE><VOUCHER/><VOUCHER/></ENVELOPE>'), /returned 2 voucher/);
});

test("Tally CMPINFO voucher counter is not treated as a data record", () => {
  const result = parseVoucherJson('<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DESC><CMPINFO><COMPANY>0</COMPANY><VOUCHER>1</VOUCHER></CMPINFO></DESC><DATA><TALLYMESSAGE><VOUCHER VCHTYPE="Sales New"><VOUCHERNUMBER>44</VOUCHERNUMBER><PARTYLEDGERNAME>Anjan Ambare</PARTYLEDGERNAME></VOUCHER></TALLYMESSAGE></DATA></BODY></ENVELOPE>');
  assert.equal(result.vouchernumber, '44');
  assert.equal(result.partyledgername, 'Anjan Ambare');
  assert.throws(() => parseVoucherJson('<ENVELOPE><BODY><DESC><CMPINFO><VOUCHER>1</VOUCHER></CMPINFO></DESC><DATA/></BODY></ENVELOPE>'), /returned 0 voucher/);
  assert.throws(() => parseVoucherJson('<ENVELOPE><BODY><DESC><CMPINFO><VOUCHER>2</VOUCHER></CMPINFO></DESC><DATA><VOUCHER/><VOUCHER/></DATA></BODY></ENVELOPE>'), /returned 2 voucher/);
});

test("Tally internal separators are removed while valid entities and Unicode remain", () => {
  const result = parseVoucherJson('\uFEFF<VOUCHER><PARTYLEDGERNAME>\u0004Anjan &#4;Ambare&#x04; &amp; Sons</PARTYLEDGERNAME><NARRATION>मराठी &#10;note &#x1F600;</NARRATION><AMOUNT>-250.00</AMOUNT></VOUCHER>');
  assert.equal(result.partyledgername, 'Anjan Ambare & Sons');
  assert.equal(result.amount, '-250.00');
  assert.ok(result.narration.includes('मराठी'));
  assert.ok(result.narration.includes('😀'));
});

test("Real XML corruption remains an error with a safe reason", () => {
  assert.throws(() => parseVoucherJson('<VOUCHER><NAME>private customer</VOUCHER>'), /malformed voucher XML:/);
  try { parseVoucherJson('<VOUCHER><NAME>private customer</VOUCHER>'); } catch (error) {
    assert.equal(error.message.includes('private customer'), false);
  }
});

test("Tally UDF fields survive missing or empty namespace declarations", () => {
  for (const declaration of ['', ' xmlns:UDF=""', ' xmlns:UDF="TallyUDF"']) {
    const result = parseVoucherJson(`<VOUCHER${declaration}><VOUCHERNUMBER>44</VOUCHERNUMBER><UDF:CUSTOMFIELD.LIST><UDF:CUSTOMFIELD>Dealer</UDF:CUSTOMFIELD></UDF:CUSTOMFIELD.LIST></VOUCHER>`);
    assert.equal(result.vouchernumber, '44');
    assert.equal(result.udf_customfield[0].udf_customfield, 'Dealer');
  }
});
