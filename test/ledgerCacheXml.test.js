import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCacheCompanies, buildCacheLedgersRequest, buildCacheManifestRequest, buildCacheVoucherBatchRequest, parseCacheVoucherTypes, parseCacheVoucherBatch} from '../src/main/utils/tally-connector-engine/ledgerCacheXml.js';

const wrap = (body) => `<ENVELOPE><BODY><DATA><COLLECTION>${body}</COLLECTION></DATA></BODY></ENVELOPE>`;
test('Full-history queries start at company books date and refuse an implicit current period', () => {
  const [company] = parseCacheCompanies(wrap('<COMPANY NAME="Sai"><GUID>guid</GUID><STARTINGFROM>20220401</STARTINGFROM></COMPANY>'));
  assert.equal(company.books_from, '20220401');
  for (const xml of [buildCacheLedgersRequest(company.name, company.books_from), buildCacheManifestRequest(company.name, company.books_from), buildCacheVoucherBatchRequest(company.name, ['1'], company.books_from)]) {
    assert.match(xml, /<SVFROMDATE TYPE="Date">20220401<\/SVFROMDATE>/);
    assert.doesNotMatch(xml, /19000101/);
  }
  assert.throws(() => buildCacheManifestRequest('Sai'), /BooksFrom/);
  assert.throws(() => buildCacheLedgersRequest('Sai'), /BooksFrom/);
});

test('Custom non-posting types inherit their parent while accounting vouchers require allocations', () => {
  const types = parseCacheVoucherTypes(wrap('<VOUCHERTYPE NAME="Mfg Journal"><PARENT>Stock Journal</PARENT></VOUCHERTYPE><VOUCHERTYPE NAME="Work Request"><PARENT>Purchase Order</PARENT></VOUCHERTYPE><VOUCHERTYPE NAME="Sales New"><PARENT>Sales</PARENT></VOUCHERTYPE>'));
  assert.equal(types.has('Mfg Journal'), true);
  assert.equal(types.has('Work Request'), true);
  assert.equal(types.has('Sales New'), false);
  const voucher = (type) => wrap(`<VOUCHER><MASTERID>1</MASTERID><ALTERID>1</ALTERID><DATE>20250401</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><ALLLEDGERENTRIES.LIST> </ALLLEDGERENTRIES.LIST></VOUCHER>`);
  const manifest = [{id:'1', alter_id:'1', signature:'one'}];
  assert.deepEqual(parseCacheVoucherBatch(voucher('Mfg Journal'), manifest, types)[0].entries, []);
  assert.throws(() => parseCacheVoucherBatch(voucher('Sales New'), manifest, types), /without ledger allocations/);
});
