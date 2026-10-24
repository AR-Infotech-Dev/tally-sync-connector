import test from 'node:test';
import assert from 'node:assert/strict';
import {parseImportResponse} from '../src/main/utils/tally-connector-engine/xml.js';
test('Tally held exceptions remain failures even when ERRORS is zero',()=>{
  const result=parseImportResponse('<RESPONSE><CREATED>0</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>1</EXCEPTIONS></RESPONSE>');
  assert.equal(result.summary.exceptions,1);assert.equal(result.ok,false);
  assert.equal(parseImportResponse('<RESPONSE><CREATED>1</CREATED><EXCEPTIONS>1</EXCEPTIONS></RESPONSE>').ok,false);
  assert.equal(parseImportResponse('<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>').ok,true);
});
