import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMParser} from '@xmldom/xmldom';
import {buildReceiptVoucherXml,buildPaymentVoucherXml} from '../src/main/utils/tally-connector-engine/xml.js';

const input={voucher_number:'12',date:'2026-10-31',party:{ledger_name:'Aniket Sonawane'},payment:{ledger_name:'Cash'},amount:750};
const field=(node,name)=>node.getElementsByTagName(name)[0]?.textContent.trim();

for (const [type,build,key,partyAmount,cashAmount] of [
  ['Receipt',buildReceiptVoucherXml,'receipt','750','-750'],
  ['Payment',buildPaymentVoucherXml,'payment','-750','750'],
]) {
  for (const billReference of [undefined,'25']) {
    test(`${type} builds balanced accounting entries ${billReference?'against a bill':'without order fields'}`,()=>{
      const xml=build({companyName:'Sai Enterprises',[key]:{...input,voucher_type:type,...(billReference?{bill_reference:billReference,bill_type:'Agst Ref'}:{})}});
      const doc=new DOMParser().parseFromString(xml,'text/xml');
      const voucher=doc.getElementsByTagName('VOUCHER')[0];
      assert.equal(voucher.getAttribute('VCHTYPE'),type);
      assert.equal(field(voucher,'VOUCHERNUMBER'),'12');
      assert.equal(field(voucher,'DATE'),'20261031');
      assert.equal(field(voucher,'ISINVOICE'),'No');
      assert.equal(voucher.getElementsByTagName('ORDERNO').length,0);
      assert.equal(voucher.getElementsByTagName('REFERENCE').length,0);
      const entries=Array.from(voucher.getElementsByTagName('ALLLEDGERENTRIES.LIST'));
      assert.equal(entries.length,2);
      const party=entries.find(entry=>field(entry,'LEDGERNAME')==='Aniket Sonawane');
      const cash=entries.find(entry=>field(entry,'LEDGERNAME')==='Cash');
      assert.equal(field(party,'AMOUNT'),partyAmount);
      assert.equal(field(cash,'AMOUNT'),cashAmount);
      assert.equal(Number(field(party,'AMOUNT'))+Number(field(cash,'AMOUNT')),0);
      const bills=party.getElementsByTagName('BILLALLOCATIONS.LIST');
      assert.equal(bills.length,billReference?1:0);
      if(billReference){assert.equal(field(bills[0],'NAME'),'25');assert.equal(field(bills[0],'BILLTYPE'),'Agst Ref');assert.equal(field(bills[0],'AMOUNT'),partyAmount);}
    });
  }
}
