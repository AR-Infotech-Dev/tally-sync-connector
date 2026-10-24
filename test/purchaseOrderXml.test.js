import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {buildPurchaseOrderXml,buildPurchaseVoucherXml} from '../src/main/utils/tally-connector-engine/xml.js';

const order={voucher_type:'Purchase Order',voucher_number:'PO-001',order_number:'PO-001',date:'2026-10-31',order_due_date:'2026-11-07',party:{ledger_name:'ABC Suppliers'},items:[{stock_item:'Dell Laptop 15-inch',quantity:250,unit:'Nos',rate:699,amount:174750,godown:'Main Location',batch:{name:'Primary Batch',godown:'Main Location'}}],total_amount:174750};
const field=(node,name)=>node.getElementsByTagName(name)[0]?.textContent.trim();

test('Purchase Order supplied payload includes its order reference in the batch allocation',()=>{
  const doc=new DOMParser().parseFromString(buildPurchaseOrderXml({companyName:'Example',order}),'text/xml');
  const batch=doc.getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.ok(batch);assert.equal(field(batch,'ORDERNO'),'PO-001');
  assert.equal(field(batch,'GODOWNNAME'),'Main Location');assert.equal(field(batch,'BATCHNAME'),'Primary Batch');
  assert.equal(field(batch,'ACTUALQTY'),'250 Nos');assert.equal(field(batch,'AMOUNT'),'-174750');
  assert.equal(field(batch,'ORDERDUEDATE'),'7-Nov-2026');
});
test('Purchase Order without explicit batch still carries order allocation and escapes references',()=>{
  const input={...order,order_number:'PO<&>2',items:[{...order.items[0],batch:undefined,godown:undefined}]};
  const doc=new DOMParser().parseFromString(buildPurchaseOrderXml({companyName:'Example',order:input}),'text/xml');
  const batch=doc.getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.equal(field(batch,'ORDERNO'),'PO<&>2');assert.equal(field(batch,'BATCHNAME'),'Primary Batch');
});
test('Purchase invoice does not gain a forced purchase-order allocation',()=>{
  const input={...order,voucher_type:'Purchase',purchase_ledger:'Purchase',items:[{...order.items[0],batch:undefined,godown:undefined}]};
  const doc=new DOMParser().parseFromString(buildPurchaseVoucherXml({companyName:'Example',purchase:input}),'text/xml');
  assert.equal(doc.getElementsByTagName('BATCHALLOCATIONS.LIST').length,0);
});

test('Purchase Order critical fields match the native exported voucher',()=>{
  const input={...order,voucher_number:'1',order_number:'1',order_due_date:'2026-10-31',purchase_ledger:'Purchase',party:{ledger_name:'Aniket Sonawane'},items:[{...order.items[0],quantity:100,amount:69900}],total_amount:69900};
  const doc=new DOMParser().parseFromString(buildPurchaseOrderXml({companyName:'Example',order:input}),'text/xml');
  const voucher=doc.getElementsByTagName('VOUCHER')[0];
  assert.equal(voucher.getAttribute('OBJVIEW'),'Invoice Voucher View');assert.equal(field(voucher,'ISINVOICE'),'No');assert.equal(field(voucher,'REFERENCE'),'1');
  assert.equal(voucher.getElementsByTagName('VCHENTRYMODE').length,0);
  const inventory=voucher.getElementsByTagName('ALLINVENTORYENTRIES.LIST')[0];
  assert.equal(field(inventory,'AMOUNT'),'-69900');assert.equal(field(inventory,'ISDEEMEDPOSITIVE'),'Yes');
  const accounting=inventory.getElementsByTagName('ACCOUNTINGALLOCATIONS.LIST')[0];
  assert.equal(field(accounting,'LEDGERNAME'),'Purchase');assert.equal(field(accounting,'AMOUNT'),'-69900');
  const batch=inventory.getElementsByTagName('BATCHALLOCATIONS.LIST')[0];assert.equal(field(batch,'ORDERNO'),'1');
  assert.equal(batch.getElementsByTagName('DESTINATIONGODOWNNAME').length,0);
  assert.equal(batch.getElementsByTagName('ORDERDUEDATE')[0].getAttribute('JD'),'46325');
  assert.equal(field(voucher.getElementsByTagName('LEDGERENTRIES.LIST')[0],'AMOUNT'),'69900');
});
