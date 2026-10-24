import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createLedgerCache, cacheScope } from "../src/main/models/ledgerCache.model.js";

const config = {serverUrl:'http://server',clientId:'A',tallyUrl:'http://tally'};
const scope = cacheScope(config);
const identity = {name:'Sai Enterprises',guid:'company-1'};
const lookup = {company:identity.name,ledger_name:'Anjan Ambare',from_date:'2026-10-01',to_date:'2026-10-31'};
const ledgers = [{name:lookup.ledger_name,master_id:'1',guid:'ledger-1',opening_cents:-10000}];
const voucher = (id, date, debit, credit, signature=id) => ({id,alter_id:signature,signature,date,voucher_no:`00${id}`,voucher_type:'Sales New',narration:'test',entries:[{ledger_name:lookup.ledger_name,debit_cents:debit,credit_cents:credit,particulars:['Sales']}]});
function publish(cache, rows, masters=ledgers) {
  const run=cache.begin(scope,identity);
  cache.stageLedgers(run, masters); cache.stageVouchers(run,rows); cache.publish(run,rows);
  return run;
}

test('SQLite statements calculate period opening and never read staging rows',t=>{
  const cache=createLedgerCache(':memory:'); t.after(()=>cache.close());
  assert.throws(()=>cache.statement(scope,lookup),{httpStatus:503});
  publish(cache,[voucher('1','2026-09-30',5000,0),voucher('2','2026-10-31',25000,0)]);
  let result=cache.statement(scope,lookup);
  assert.deepEqual(result.opening_balance,{amount:50,type:'Cr'});
  assert.deepEqual(result.closing_balance,{amount:200,type:'Dr'});
  assert.equal(result.entries[0].voucher_no,'002');
  assert.equal(result.source,'local_sqlite');
  assert.equal(cache.statement(scope,{...lookup,company:'  sai   enterprises  '}).total_debit,250);
  assert.equal(cache.summary(scope,'sai enterprises').cached_vouchers,2);
  const summary=cache.summary(scope,identity.name);
  assert.equal(summary.cached_ledgers,1);assert.equal(summary.cached_vouchers,2);assert.equal(summary.cached_entries,2);
  const run=cache.begin(scope,identity);cache.stageLedgers(run,ledgers);cache.stageVouchers(run,[voucher('2','2026-10-31',99900,0,'changed')]);
  result=cache.statement(scope,lookup); assert.equal(result.total_debit,250);
  cache.fail(run,new Error('connection lost')); result=cache.statement(scope,lookup);
  assert.equal(result.total_debit,250);assert.equal(result.is_stale,true);assert.equal(result.sync_status,'stale');
});

test('Edits, cancellations and deleted vouchers replace old allocations atomically',t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());
  publish(cache,[voucher('1','2026-10-01',10000,0),voucher('2','2026-10-02',20000,0)]);
  const run=cache.begin(scope,identity);cache.stageLedgers(run,ledgers);
  const changed=voucher('1','2026-09-30',5000,0,'updated');cache.stageVouchers(run,[changed]);
  cache.publish(run,[changed]);
  let result=cache.statement(scope,lookup);assert.equal(result.entries.length,0);assert.equal(result.opening_balance.amount,50);
  const cancelled={...changed,signature:'cancelled',entries:[]};
  const next=cache.begin(scope,identity);cache.stageLedgers(next,ledgers);cache.stageVouchers(next,[cancelled]);cache.publish(next,[cancelled]);
  result=cache.statement(scope,lookup);assert.equal(result.opening_balance.amount,100);
  assert.equal(cache.signatures(next).size,1);
});

test('Unchanged vouchers survive incremental sync; ledger removal and tenant boundaries are enforced',t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());
  const original=voucher('1','2026-10-31',25000,0);publish(cache,[original]);
  const run=cache.begin(scope,identity);cache.stageLedgers(run,ledgers);cache.publish(run,[original]);
  assert.equal(cache.statement(scope,lookup).total_debit,250);
  assert.throws(()=>cache.statement(cacheScope({...config,clientId:'B'}),lookup),{httpStatus:503});
  assert.throws(()=>cache.statement(scope,{...lookup,ledger_name:'missing'}),{httpStatus:404});
  assert.throws(()=>cache.statement(scope,{...lookup,ledger_name:"' OR 1=1 --"}),{httpStatus:404});
  const removed=cache.begin(scope,identity);cache.stageLedgers(removed,[]);cache.publish(removed,[]);
  assert.throws(()=>cache.statement(scope,lookup),{httpStatus:404});
});

test('Persistent SQLite survives restart and discards interrupted staging data',()=>{
  const directory=fs.mkdtempSync(path.resolve('Connector/test/.cache-test-'));
  const file=path.join(directory,'cache.sqlite');
  let cache;
  try {
    cache=createLedgerCache(file);publish(cache,[voucher('1','2026-10-31',25000,0)]);
    const interrupted=cache.begin(scope,identity);cache.stageLedgers(interrupted,ledgers);cache.stageVouchers(interrupted,[voucher('1','2026-10-31',99900,0,'new')]);cache.close();
    cache=createLedgerCache(file);assert.equal(cache.statement(scope,lookup).total_debit,250);
  } finally {
    cache?.close();for(const suffix of ['', '-wal','-shm'])fs.rmSync(file+suffix,{force:true});fs.rmdirSync(directory);
  }
});

test('A restored company GUID replaces the same-name cache only after a successful snapshot',t=>{
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());
  publish(cache,[voucher('1','2026-10-31',25000,0)]);
  const run=cache.begin(scope,{...identity,guid:'restored-company'});
  cache.stageLedgers(run,ledgers);cache.stageVouchers(run,[voucher('1','2026-10-31',50000,0)]);
  // Pending replacement must not expose a partially initialized new company.
  cache.fail(run,new Error('retry'));
  // The last complete snapshot remains readable; no partial replacement is exposed.
  assert.equal(cache.statement(scope,lookup).total_debit,250);
  const next=cache.begin(scope,{...identity,guid:'restored-company'});
  cache.stageLedgers(next,ledgers);const changed=voucher('1','2026-10-31',50000,0);cache.stageVouchers(next,[changed]);cache.publish(next,[changed]);
  assert.equal(cache.statement(scope,lookup).total_debit,500);
});

test('Existing local database receives the status column without data deletion',()=>{
  const directory=fs.mkdtempSync(path.resolve('Connector/test/.migration-test-'));const file=path.join(directory,'cache.sqlite');let cache;
  try {
    const legacy=new DatabaseSync(file);
    legacy.exec("CREATE TABLE cache_companies(scope TEXT NOT NULL,guid TEXT NOT NULL,name TEXT NOT NULL,dataset TEXT NOT NULL,last_synced_at TEXT,last_attempt_at TEXT,sync_status TEXT NOT NULL DEFAULT 'pending',sync_error TEXT,PRIMARY KEY(scope,guid))");
    legacy.prepare('INSERT INTO cache_companies(scope,guid,name,dataset,last_synced_at) VALUES(?,?,?,?,?)').run(scope,identity.guid,identity.name,'legacy-dataset','2026-10-23T00:00:00.000Z');legacy.close();
    cache=createLedgerCache(file);assert.equal(cache.summary(scope,identity.name).companies[0].last_synced_at,'2026-10-23T00:00:00.000Z');
  }finally{cache?.close();for(const suffix of ['','-wal','-shm'])fs.rmSync(file+suffix,{force:true});fs.rmdirSync(directory);}
});
