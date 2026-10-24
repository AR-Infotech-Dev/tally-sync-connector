import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { makeRequest } from "../src/main/api/httpClient.js";
import { fetchSalesOrderRequest } from "../src/main/modules/vouchers/sales-order/services/sales-order.api.js";
import { fetchSalesVoucherRequest } from "../src/main/modules/vouchers/sales/services/sales.api.js";
import { fetchPurchaseOrderRequest } from "../src/main/modules/vouchers/purchase-order/services/purchase-order.api.js";
import { fetchPurchaseVoucherRequest } from "../src/main/modules/vouchers/purchase/services/purchase.api.js";
import { fetchReceiptVoucherRequest } from "../src/main/modules/vouchers/receipt/services/receipt.api.js";
import { fetchPaymentVoucherRequest } from "../src/main/modules/vouchers/payment/services/payment.api.js";
import { uploadSalesVoucherPdf, updateSalesVoucherPdfStatus } from "../src/main/modules/vouchers/sales/services/salesPdf.api.js";
import { registerClientRequest, activateConnectorRequest } from "../src/main/services/clientRegistration.api.js";
import { fetchLedgerStatementRequest } from "../src/main/modules/ledgers/services/ledgerStatement.api.js";

// Contract-shaped local HTTP responses; no production requests or Tally writes.
async function fixture(t) {
  const server = http.createServer(async (req, res) => {
    const chunks=[];
    for await(const chunk of req) chunks.push(chunk);
    const body=Buffer.concat(chunks);
    if(req.url==="/error") {res.writeHead(401,{"Content-Type":"application/json"});res.end(JSON.stringify({success:false,code:2005,type:"UNAUTHORIZED",message:"Invalid client credentials."}));return;}
    if(req.url==="/business-error") {res.end(JSON.stringify({success:false,code:2012,message:"Job failed."}));return;}
    if(req.url==="/html") {res.writeHead(502);res.end("<html>Proxy failed</html>");return;}
    if(req.url==="/invalid-json") {res.end("invalid");return;}
    if(req.url==="/slow") {setTimeout(()=>res.end('{}'),150);return;}
    if(req.url==="/empty") {res.writeHead(204);res.end();return;}
    if(req.url==="/zero") {res.end('{"success":true,"data":0}');return;}
    res.setHeader("Content-Type","application/json");
    res.end(JSON.stringify({success:true,data:{path:req.url,method:req.method,headers:req.headers,body:body.toString('utf8')}}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  t.after(()=>{server.closeAllConnections();server.close();});
  return {serverUrl:`http://127.0.0.1:${server.address().port}`,clientId:"test-client",connectorKey:"test-key"};
}

test("Each voucher service calls its own endpoint and forwards extra options",async t=>{
  const config=await fixture(t);
  for(const [fetchRequest,route]of [[fetchSalesOrderRequest,'sales-orders'],[fetchSalesVoucherRequest,'sales'],[fetchPurchaseOrderRequest,'purchase-orders'],[fetchPurchaseVoucherRequest,'purchases'],[fetchReceiptVoucherRequest,'receipts'],[fetchPaymentVoucherRequest,'payments']]){
    const result=await fetchRequest({config,requestId:'id/1',params:{company:'A & B'},headers:{'X-Trace-ID':'trace'}});
    assert.equal(result.path,`/api/v1/${route}/id%2F1/connector?company=A+%26+B`);
    assert.equal(result.headers['x-client-id'],'test-client');assert.equal(result.headers['x-connector-key'],'test-key');assert.equal(result.headers['x-trace-id'],'trace');
  }
  assert.equal((await fetchLedgerStatementRequest({config,requestId:'ledger-job'})).path,'/api/v1/sales-orders/ledger-job/connector');
});

test("Shared client handles query, JSON, response modes, PDF bytes and setup requests",async t=>{
  const config=await fixture(t);
  const result=await makeRequest('/echo', { config: config, method: 'POST', params: {tag:['a','b'],ignored:null}, body: {amount:750}, cache: 'no-store', unwrapData: true });
  assert.equal(result.method,'POST');assert.equal(result.path,'/echo?tag=a&tag=b');assert.deepEqual(JSON.parse(result.body),{amount:750});
  const pdf=await uploadSalesVoucherPdf({config,requestId:'pdf-id',pdf:Buffer.from('%PDF-test'),filename:'statement.pdf'});
  assert.equal(pdf.body,'%PDF-test');assert.equal(pdf.headers['content-type'],'application/pdf');assert.equal(pdf.headers['x-pdf-filename'],'statement.pdf');
  const status=await updateSalesVoucherPdfStatus({config,requestId:'pdf-id',status:'failed',error:'test failure'});
  assert.deepEqual(JSON.parse(status.body),{status:'failed',error:'test failure'});
  const setup=await registerClientRequest(config.serverUrl,{name:'Name',companyName:'Company',email:'example@example.com',tallyLicenseNo:'123'});
  assert.equal(setup.success,true);assert.equal(setup.data.path,'/api/v1/clients/register');assert.equal(setup.data.headers['x-connector-key'],undefined);assert.equal(JSON.parse(setup.data.body).company_name,'Company');
  assert.equal(JSON.parse((await activateConnectorRequest(config.serverUrl,'activation')).data.body).activation_code,'activation');
  assert.equal(await makeRequest('/zero', { config: config, unwrapData: true }),0);
  assert.equal(await makeRequest('/empty', { config: config, unwrapData: true }),null);
  assert.equal(typeof await makeRequest('/echo', { config: config, responseType: 'text', unwrapData: true }),'string');
  assert.ok(Buffer.isBuffer(await makeRequest('/echo', { config: config, responseType: 'buffer', unwrapData: true })));
});

test("Shared client propagates Server errors and rejects malformed responses and oversized bodies",async t=>{
  const config=await fixture(t);
  await assert.rejects(makeRequest('/error', { config: config, unwrapData: true }),e=>e.httpStatus===401&&e.code===2005&&e.message==='Invalid client credentials.');
  await assert.rejects(makeRequest('/business-error', { config: config, unwrapData: true }),/Job failed/);
  await assert.rejects(makeRequest('/html', { config: config, unwrapData: true }),e=>e.httpStatus===502);
  await assert.rejects(makeRequest('/invalid-json', { config: config, unwrapData: true }),e=>e.code==='INVALID_SERVER_RESPONSE');
  await assert.rejects(makeRequest('/echo', { config: config, maxResponseBytes: 10, unwrapData: true }),/oversized/);
  await assert.rejects(makeRequest('https://other.example/path', { config: config, unwrapData: true }),/valid HTTP/);
});

test("Shared client enforces timeouts and caller cancellation without automatic retries",async t=>{
  const config=await fixture(t);
  await assert.rejects(makeRequest('/slow', { config: config, timeout: 20, unwrapData: true }),e=>e.code==='SERVER_TIMEOUT');
  const controller=new AbortController();controller.abort();
  await assert.rejects(makeRequest('/slow', { config: config, signal: controller.signal, unwrapData: true }),e=>e.code==='SERVER_CANCELLED');
});

test("makeRequest preserves response metadata and supports multipart bodies and blobs",async t=>{
  const config=await fixture(t);
  const result=await makeRequest('/echo',{config,params:{company:'A & B'}});
  assert.equal(result.status,200);assert.equal(result.success,true);
  assert.equal(result.data.path,'/echo?company=A+%26+B');
  const form=new FormData();form.set('reference','REF-1');
  const upload=await makeRequest('/echo',{config,method:'POST',body:form,headers:{'Content-Type':'application/json'}});
  assert.match(upload.data.headers['content-type'],/^multipart\/form-data; boundary=/);
  assert.match(upload.data.body,/REF-1/);
  const binary=await makeRequest('/echo',{config,responseType:'blob'});
  assert.equal(binary.status,200);assert.ok(binary.data instanceof Blob);
});
