import test from 'node:test';
import assert from 'node:assert/strict';
import * as builders from '../src/main/utils/tally-connector-engine/xml.js';

const input={voucher_number:'12',order_number:'12',date:'2026-10-31',order_due_date:'2026-11-07',party:{ledger_name:'Party'},payment:{ledger_name:'Cash'},amount:750,items:[{stock_item:'Item',quantity:1,unit:'Nos',rate:750,amount:750}],total_amount:750};
const cases=[['buildReceiptVoucherXml','receipt'],['buildPaymentVoucherXml','payment'],['buildSalesOrderXml','order'],['buildSalesVoucherXml','sales'],['buildPurchaseOrderXml','order'],['buildPurchaseVoucherXml','purchase']];

test('All voucher builders escape scalar UDF values and reject XML injection and nested values',()=>{
  for(const [name,key] of cases){
    const build=custom_fields=>builders[name]({companyName:'Example',[key]:{...input,custom_fields}});
    const xml=build({Note:'<tag>&',Enabled:false,Count:2});
    assert.ok(xml.includes('<UDF:Note>&lt;tag&gt;&amp;</UDF:Note>'),name);
    assert.ok(xml.includes('<UDF:Enabled>false</UDF:Enabled>'),name);
    assert.ok(xml.includes('<UDF:Count>2</UDF:Count>'),name);
    for(const invalid of [{'<injected>':'value'},{Nested:{}},{Null:null}])assert.throws(()=>build(invalid),/Unsupported custom field/,name);
    assert.throws(()=>build([]),/custom_fields must be a JSON object/,name);
  }
});
