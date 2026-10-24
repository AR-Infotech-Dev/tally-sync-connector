import test from 'node:test';
import assert from 'node:assert/strict';
import { renderXmlTemplate } from '../src/main/utils/tally-connector-engine/shared/template/templateRenderer.js';

test('Voucher template renderer confines reads to the template directory',()=>{
  for(const filename of ['../package.json','../../other.hbs','shared/xmlHelpers.js']){
    assert.throws(()=>renderXmlTemplate(filename,{}),/Invalid voucher template path/);
  }
});

test('Envelope template renders message collections and fails on missing context',()=>{
  const context={company:'',messages:['<VOUCHER/>','<VOUCHER/>']};
  const xml=renderXmlTemplate('shared/XML/import-envelope.xml.hbs',context);
  assert.ok(xml.includes('<REQUESTDATA><VOUCHER/><VOUCHER/></REQUESTDATA>'));
  assert.equal(renderXmlTemplate('shared/XML/import-envelope.xml.hbs',context),xml);
  assert.throws(()=>renderXmlTemplate('shared/XML/import-envelope.xml.hbs',{messages:[]}),/company/);
});
