import test from 'node:test';
import assert from 'node:assert/strict';
import {createLedgerCache,cacheScope} from '../src/main/models/ledgerCache.model.js';
import {syncLedgerCompany,createLedgerSync} from '../src/main/services/ledgerSync.service.js';

const config={serverUrl:'http://server',clientId:'a',tallyUrl:'http://tally',tallyCompany:'Sai'};
const identity={name:'Sai',guid:'company'};
const ledger={name:'Customer',master_id:'1',guid:'ledger',opening_cents:0};
const row={id:'1',alter_id:'1',signature:'1',date:'2026-10-01',voucher_no:'1',voucher_type:'Sales',narration:'',entries:[{ledger_name:'Customer',debit_cents:25000,credit_cents:0,particulars:[]}]};
const lookup={company:'Sai',ledger_name:'Customer',from_date:'2026-10-01',to_date:'2026-10-31'};

test('Source changes during sync never overwrite the last published snapshot',async t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());const scope=cacheScope(config);
  const source={companies:async()=>[identity],ledgers:async()=>[ledger],manifest:async()=>[row],vouchers:async()=>[row]};
  await syncLedgerCompany({cache,scope,identity,source,signal:new AbortController().signal,batchDelayMs:0});
  let count=0;const mutation={...source,manifest:async()=>[{...row,signature:++count===1?'2':'3'}],vouchers:async()=>[{...row,signature:'2',entries:[{...row.entries[0],debit_cents:99900}]}]};
  await assert.rejects(syncLedgerCompany({cache,scope,identity,source:mutation,signal:new AbortController().signal,batchDelayMs:0}),/changed during sync/);
  assert.equal(cache.statement(scope,lookup).total_debit,250);
});

test('Three minute timer cannot overlap an active sync; stop cancels the session',async t=>{
  t.mock.timers.enable({apis:['setInterval']});let calls=0;let resolve;let signal;
  const gate=new Promise(r=>{resolve=r;});
  const sync=createLedgerSync({cache:{failScope(){}},sourceFactory:(_config,currentSignal)=>{signal=currentSignal;return {companies:async()=>{calls++;return gate;}};}});
  sync.start(config);assert.equal(calls,1);assert.equal(sync.running,true);
  t.mock.timers.tick(180000*3);assert.equal(calls,1);
  sync.stop();assert.equal(signal.aborted,true);resolve([]);
  await new Promise(r=>setImmediate(r));t.mock.timers.tick(180000);assert.equal(calls,1);
});

test('Local statement reads never invoke the Tally sync source',t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());const scope=cacheScope(config);
  const run=cache.begin(scope,identity);cache.stageLedgers(run,[ledger]);cache.stageVouchers(run,[row]);cache.publish(run,[row]);
  const sync=createLedgerSync({cache,sourceFactory:()=>{throw new Error('A statement must not call Tally');}});
  assert.equal(sync.statement(config,lookup).total_debit,250);
  assert.equal(sync.statement(config,lookup).source,'local_sqlite');
});

test('Configured company matches Tally name regardless of casing or extra spaces',async t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());
  let finish;const done=new Promise(resolve=>{finish=resolve;});
  const source={companies:async()=>[identity],ledgers:async()=>[ledger],manifest:async()=>[],vouchers:async()=>[]};
  const sync=createLedgerSync({cache,sourceFactory:()=>source,onActivity:event=>{if(['succeeded','failed'].includes(event.status))finish(event);}});t.after(()=>sync.stop());
  sync.start({...config,tallyCompany:'  sAI  '});
  const result=await done;assert.equal(result.status,'succeeded');assert.equal(sync.getStatus({...config,tallyCompany:'sai'}).cached_ledgers,1);
});
