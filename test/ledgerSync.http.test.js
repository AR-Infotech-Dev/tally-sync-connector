import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createLedgerCache, cacheScope } from "../src/main/models/ledgerCache.model.js";
import { createLedgerSyncSource } from "../src/main/services/ledgerSync.source.js";
import { syncLedgerCompany } from "../src/main/services/ledgerSync.service.js";

// Contract fixtures, not a captured live Tally export. Real production HTTP,
// XML parsers and SQLite execute against this local stand-in.
const wrap = (body) => `<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DESC><CMPINFO><VOUCHER>1</VOUCHER></CMPINFO></DESC><DATA><COLLECTION>${body}</COLLECTION></DATA></BODY></ENVELOPE>`;
const companyXml = wrap('<COMPANY NAME="Sai Enterprises"><NAME>Sai Enterprises</NAME><GUID>company-guid</GUID><BOOKSFROM>20220401</BOOKSFROM></COMPANY>');
const ledgerXml = wrap(['Anjan Ambare','Sales'].map((name,index)=>`<LEDGER NAME="${name}"><NAME>${name}</NAME><MASTERID>${index+1}</MASTERID><GUID>ledger-${index}</GUID><FLOWUPSOPENINGAMOUNT>0.00</FLOWUPSOPENINGAMOUNT><FLOWUPSOPENINGDR>Yes</FLOWUPSOPENINGDR></LEDGER>`).join(''));
const header = (row) => `<MASTERID>${row.id}</MASTERID><ALTERID>${row.alter}</ALTERID><GUID>voucher-${row.id}</GUID><DATE>${row.date}</DATE><VOUCHERNUMBER>00${row.id}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales New</VOUCHERTYPENAME><ISCANCELLED>${row.cancelled?'Yes':'No'}</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>`;
const detail = (row) => `<VOUCHER>${header(row)}<FLOWUPSNONPOSTING>No</FLOWUPSNONPOSTING><ALLLEDGERENTRIES.LIST><LEDGERNAME>Anjan Ambare</LEDGERNAME><AMOUNT>-${row.amount}</AMOUNT><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>${row.amount}</AMOUNT><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE></ALLLEDGERENTRIES.LIST></VOUCHER>`;

test('Real HTTP sync publishes SQLite snapshots, fetches changed IDs only, handles deletion and upstream failure',async t=>{
  let rows=[{id:'1',alter:'1',date:'20261031',amount:'250.00'},{id:'2',alter:'2',date:'20261031',amount:'100.00'}];
  let fail=false; const requests=[];
  const server=http.createServer(async(req,res)=>{
    let xml='';for await(const chunk of req)xml+=chunk;
    const id=xml.match(/<ID>([^<]+)<\/ID>/)?.[1];requests.push({id,xml});
    if(fail){res.writeHead(500,{'content-type':'text/html'});res.end('<html>upstream unavailable</html>');return;}
    let response;
    if(id==='Flowups Cache Companies')response=companyXml;
    else if(id==='Flowups Cache Voucher Types')response=wrap('');
    else if(id==='Flowups Cache Ledgers')response=ledgerXml;
    else if(id==='Flowups Cache Manifest')response=wrap(rows.map(row=>`<VOUCHER>${header(row)}</VOUCHER>`).join(''));
    else if(id==='Flowups Cache Voucher Batch'){
      const ids=[...xml.matchAll(/\$MasterID = (\d+)/g)].map(match=>match[1]);
      response=wrap(rows.filter(row=>ids.includes(row.id)).map(detail).join(''));
    }else{res.writeHead(501);res.end('Unsupported contract request');return;}
    res.writeHead(200,{'content-type':'text/xml; charset=utf-8'});res.end(response);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const cache=createLedgerCache(':memory:');t.after(()=>cache.close());
  const config={serverUrl:'http://server',clientId:'client-a',tallyUrl:`http://127.0.0.1:${server.address().port}`,requestTimeoutSeconds:1};
  const scope=cacheScope(config);const source=createLedgerSyncSource(config,new AbortController().signal);
  const identity=(await source.companies())[0];
  const sync=()=>syncLedgerCompany({cache,scope,identity,source,signal:new AbortController().signal,batchDelayMs:0});
  const lookup={company:identity.name,ledger_name:'Anjan Ambare',from_date:'2026-10-01',to_date:'2026-10-31'};
  await sync();assert.equal(cache.statement(scope,lookup).total_debit,350);
  assert.equal(cache.statement(scope,{...lookup,ledger_name:'Sales'}).total_credit,350);
  const batchCount=()=>requests.filter(req=>req.id==='Flowups Cache Voucher Batch').length;
  const originalCount=batchCount();await sync();assert.equal(batchCount(),originalCount);
  rows=[{id:'1',alter:'3',date:'20260930',amount:'500.00'}];await sync();
  let statement=cache.statement(scope,lookup);assert.equal(statement.entries.length,0);assert.deepEqual(statement.opening_balance,{amount:500,type:'Dr'});
  const batch=requests.filter(req=>req.id==='Flowups Cache Voucher Batch').at(-1);
  assert.ok(batch.xml.includes('$MasterID = 1'));assert.equal(batch.xml.includes('$MasterID = 2'),false);
  fail=true;await assert.rejects(sync(),/HTTP 500/);
  statement=cache.statement(scope,lookup);assert.equal(statement.opening_balance.amount,500);assert.equal(statement.is_stale,true);
  assert.ok(requests.some(req=>req.id==='Flowups Cache Manifest'));
});

