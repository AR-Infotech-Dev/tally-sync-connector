import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {buildSalesOrderXml} from '../src/main/utils/tally-connector-engine/xml.js';

const order={voucher_type:'Sales Order',voucher_number:'SO-001',order_number:'CUSTOMER-001',date:'2026-10-31',order_due_date:'2026-11-07',party:{ledger_name:'Customer'},items:[{stock_item:'Dell Laptop 15-inch',quantity:250,unit:'Nos',rate:699,amount:174750,batch:{name:'Primary Batch',godown:'Main Location'}}]};
const document=(data,orderVoucher)=>new DOMParser().parseFromString(buildSalesOrderXml({companyName:'Example',order:data,orderVoucher}),'text/xml');
const field=(node,name)=>node.getElementsByTagName(name)[0]?.textContent.trim();

test('Sales Order batch allocation includes the order reference and correct outward amount',()=>{
  const batch=document(order).getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.equal(field(batch,'ORDERNO'),'CUSTOMER-001');assert.equal(field(batch,'AMOUNT'),'174750');assert.equal(field(batch,'ACTUALQTY'),'250 Nos');
  const due=batch.getElementsByTagName('ORDERDUEDATE')[0];
  assert.equal(due.textContent,'7-Nov-2026');assert.equal(due.getAttribute('P'),'7-Nov-2026');assert.match(due.getAttribute('JD'),/^\d+$/);
});
test('Custom Sales Order types use the transaction role and voucher-number fallback',()=>{
  const data={...order,voucher_type:'Custom Orders',order_number:undefined,voucher_number:'SO<&>2',items:[{...order.items[0],batch:undefined}]};
  const batch=document(data,true).getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.equal(field(batch,'ORDERNO'),'SO<&>2');assert.equal(field(batch,'GODOWNNAME'),'Main Location');assert.equal(field(batch,'BATCHNAME'),'Primary Batch');
});
test('Sales invoices retain their existing non-order batch mapping',()=>{
  const data={...order,voucher_type:'Sales'};
  const batch=document(data,false).getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.equal(field(batch,'ORDERNO'),undefined);assert.equal(field(batch,'AMOUNT'),'174750');
  assert.equal(document({...data,items:[{...data.items[0],batch:undefined}]},false).getElementsByTagName('BATCHALLOCATIONS.LIST').length,0);
});
test('An order without any usable number fails before calling Tally',()=>{
  assert.throws(()=>buildSalesOrderXml({order:{...order,voucher_number:'',order_number:''}}),/requires order_number or voucher_number/);
});
test('Order due date is required and item-level due dates override the order date',()=>{
  assert.throws(()=>buildSalesOrderXml({order:{...order,order_due_date:undefined}}),/requires order_due_date/);
  const input={...order,items:[{...order.items[0],order_due_date:'2026-11-10'}]};
  assert.equal(field(document(input).getElementsByTagName('BATCHALLOCATIONS.LIST')[0],'ORDERDUEDATE'),'10-Nov-2026');
});

test('Sales Order preserves native due-date day and uses an explicit four-digit import year',()=>{
  const data={...order,voucher_number:'1',order_number:'1',order_due_date:'2026-10-31',is_invoice:true,voucher_mode:'Item Invoice',party:{ledger_name:'Aniket Sonawane'},items:[{...order.items[0],quantity:1,amount:699}],party_ledger_entry:undefined};
  const doc=document(data,true);const voucher=doc.getElementsByTagName('VOUCHER')[0];
  assert.equal(field(voucher,'ISINVOICE'),'No');
  assert.equal(voucher.getAttribute('OBJVIEW'),'Invoice Voucher View');
  assert.equal(field(voucher,'PERSISTEDVIEW'),'Invoice Voucher View');
  assert.equal(field(voucher,'REFERENCE'),'1');
  assert.equal(voucher.getElementsByTagName('VCHENTRYMODE').length,0);
  const batch=voucher.getElementsByTagName('BATCHALLOCATIONS.LIST')[0];
  assert.equal(field(batch,'ORDERNO'),'1');
  assert.equal(batch.getElementsByTagName('DESTINATIONGODOWNNAME').length,0);
  const due=batch.getElementsByTagName('ORDERDUEDATE')[0];
  assert.equal(due.getAttribute('JD'),'46325');assert.equal(due.getAttribute('P'),'31-Oct-2026');assert.equal(due.textContent,'31-Oct-2026');
  assert.equal(field(voucher.getElementsByTagName('LEDGERENTRIES.LIST')[0],'AMOUNT'),'-699');
});
