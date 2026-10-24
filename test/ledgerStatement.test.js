import test from "node:test";
import assert from "node:assert/strict";
import { buildLedgerStatementEntriesRequest, normalizeLedgerStatement } from "../src/main/utils/tally-connector-engine/ledgerStatement.js";
import { validateLedgerStatement } from "../../Server/src/modules/ledgers/ledger.validator.js";

const lookup = { company: "Sai Enterprises", ledger_name: "Anjan Ambare", from_date: "2026-10-01", to_date: "2026-10-31" };
const master = '<ENVELOPE><BODY><DESC><CMPINFO><LEDGER>1</LEDGER></CMPINFO></DESC><DATA><COLLECTION><LEDGER NAME="Anjan Ambare"><NAME>Anjan Ambare</NAME><FLOWUPSOPENINGAMOUNT>100.00</FLOWUPSOPENINGAMOUNT><FLOWUPSOPENINGDR>Yes</FLOWUPSOPENINGDR></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>';
const entry = (date, id, amount, dr, extra = '') => `<VOUCHER><DATE>${date}</DATE><MASTERID>${id}</MASTERID><VOUCHERNUMBER>00${id}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>${extra}<ALLLEDGERENTRIES.LIST><LEDGERNAME>Anjan Ambare</LEDGERNAME><AMOUNT>${amount}</AMOUNT><ISDEEMEDPOSITIVE>${dr}</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>0</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>`;
const collection = (entries) => `<ENVELOPE><COLLECTION>${entries}</COLLECTION></ENVELOPE>`;

test("Statements include prior movements in opening, sort entries and calculate running balances", () => {
  const statement = normalizeLedgerStatement(master, collection(entry('20261020', 4, '100.00', 'No') + entry('20260901', 1, '-50.00', 'Yes') + entry('20261010', 3, '-250.00', 'Yes') + entry('20260915', 2, '25.00', 'No') + entry('20261101', 5, '-999', 'Yes') + entry('20261001', 6, '-999', 'Yes', '<ISCANCELLED>Yes</ISCANCELLED>')), lookup);
  assert.deepEqual(statement.opening_balance, { amount: 125, type: 'Dr' });
  assert.equal(statement.entries.length, 2);
  assert.equal(statement.entries[0].voucher_no, '003');
  assert.deepEqual(statement.entries[0].balance, { amount: 375, type: 'Dr' });
  assert.deepEqual(statement.entries[0].particulars, ['Sales']);
  assert.equal(statement.total_debit, 250);
  assert.equal(statement.total_credit, 100);
  assert.deepEqual(statement.closing_balance, { amount: 275, type: 'Dr' });
});

test("An existing ledger with no transactions returns an empty statement, not 404", () => {
  const statement = normalizeLedgerStatement(master, collection(''), lookup);
  assert.deepEqual(statement.entries, []);
  assert.deepEqual(statement.opening_balance, statement.closing_balance);
  assert.equal(statement.total_debit, 0);
});

test("Credit opening, repeated ledger allocations and decimal precision are normalized", () => {
  const creditMaster = master.replace('100.00', '0.30').replace('>Yes<', '>No<');
  const statement = normalizeLedgerStatement(creditMaster, collection(entry('20261001', 1, '-0.10', 'Yes') + entry('20261002', 2, '-0.20', 'Yes')), lookup);
  assert.deepEqual(statement.opening_balance, { amount: 0.3, type: 'Cr' });
  assert.deepEqual(statement.closing_balance, { amount: 0, type: null });
  assert.equal(statement.total_debit, 0.3);
});

test("Missing ledgers and incomplete upstream amounts fail explicitly", () => {
  assert.throws(() => normalizeLedgerStatement(collection(''), collection(''), lookup), { httpStatus: 404 });
  assert.throws(() => normalizeLedgerStatement(master, '<ENVELOPE/>', lookup), /collection/);
  assert.throws(() => normalizeLedgerStatement(master, collection(entry('20261001', 1, 'invalid', 'Yes')), lookup), /amount/);
  assert.throws(() => normalizeLedgerStatement(master.replace('<FLOWUPSOPENINGDR>Yes</FLOWUPSOPENINGDR>', ''), collection(''), lookup), /direction/);
});

test("Input validation rejects invalid dates, inverted ranges and objects", () => {
  assert.equal(validateLedgerStatement(lookup).length, 0);
  assert.equal(validateLedgerStatement({ledger_name: 'Cash', from_date:'2026-10-01', to_date:'2026-10-31'}).length, 0);
  for (const body of [null, [], {...lookup, ledger_name: {$ne:''}}, {...lookup, from_date:'2026-02-30'}, {...lookup, to_date:'2026-09-30'}]) assert.ok(validateLedgerStatement(body).length);
});

test("Request escapes input and filters all ledger allocations instead of party name only", () => {
  const xml = buildLedgerStatementEntriesRequest({...lookup, ledger_name:'A & B'});
  assert.ok(xml.includes('A &amp; B'));
  assert.ok(xml.includes('19000101'));
  assert.ok(xml.includes('20261031'));
  assert.ok(xml.includes('<TYPE>Voucher : Ledger</TYPE>'));
  assert.ok(xml.includes('<CHILDOF>##FlowupsStatementLedger</CHILDOF>'));
  assert.ok(xml.includes('AllLedgerEntries.*,LedgerEntries.*'));
  assert.equal(xml.includes('$$FilterCount'), false);
});

test("LedgerEntries alias is supported and duplicate aliases are not counted twice", () => {
  const xml = entry('20261031', 44, '-250', 'Yes');
  const alias = xml.replaceAll('ALLLEDGERENTRIES.LIST', 'LEDGERENTRIES.LIST');
  assert.equal(normalizeLedgerStatement(master, collection(alias), lookup).total_debit, 250);
  const both = xml.replace('</VOUCHER>', alias.replace(/^<VOUCHER>[\s\S]*?(?=<LEDGERENTRIES.LIST>)/, '').replace('</VOUCHER>', '') + '</VOUCHER>');
  assert.equal(normalizeLedgerStatement(master, collection(both), lookup).total_debit, 250);
});

test("Incomplete voucher exports do not silently become empty successful statements", () => {
  assert.throws(() => normalizeLedgerStatement(master, collection('<VOUCHER><DATE>20261031</DATE></VOUCHER>'), lookup), /without ledger allocations/);
});

test("Fallback matches ledger allocations locally and never includes another ledger", () => {
  const target = entry('20261031', 44, '-250', 'Yes');
  const unrelated = entry('20261031', 45, '-999', 'Yes').replaceAll('Anjan Ambare', 'Other Customer');
  const order = entry('20261031', 46, '-888', 'Yes', '<FLOWUPSNONPOSTING>Yes</FLOWUPSNONPOSTING>');
  const result = normalizeLedgerStatement(master, collection(target + unrelated + order), lookup, {allVouchers: true});
  assert.equal(result.entries.length, 1);
  assert.equal(result.total_debit, 250);
  assert.equal(JSON.stringify(result).includes('Other Customer'), false);
  const xml = buildLedgerStatementEntriesRequest(lookup, {allVouchers: true});
  assert.ok(xml.includes('<TYPE>Voucher</TYPE>'));
  assert.equal(xml.includes('<CHILDOF>'), false);
  assert.equal(xml.includes('<FILTER>'), false);
});

test("Empty results identify Connector query version and returned vs matched counts", () => {
  const unrelated = entry('20261031', 45, '-999', 'Yes').replaceAll('Anjan Ambare', 'Other Customer');
  const result = normalizeLedgerStatement(master, collection(unrelated), lookup, {allVouchers: true});
  assert.deepEqual(result.diagnostics, {query_version:'ledger-statement-v2', query_mode:'voucher_collection', tally_vouchers:1, matched_ledger_vouchers:0, period_entries:0});
});
