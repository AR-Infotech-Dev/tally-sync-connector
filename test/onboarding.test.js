import test from 'node:test';
import assert from 'node:assert/strict';
import {validateActivation, availableCompanies, setupReady} from '../src/renderer/src/modules/onboarding/utils/onboarding.js';
test('Onboarding validates full codes and normalizes duplicate company choices',()=>{
  assert.equal(validateActivation('A'.repeat(43)), '');
  assert.ok(validateActivation('short'));
  assert.deepEqual(availableCompanies({companies:[{name:'Sai'},{name:'Sai'},{name:'Other'}]}),['Sai','Other']);
});
test('Ready requires registration and a completed snapshot for the selected company',()=>{
  const registered={registrationState:'registered'};
  const sync={state:'ready',last_synced_at:'2026-10-23T00:00:00Z',company:'Sai'};
  assert.equal(setupReady(registered,sync,'Sai'),true);
  assert.equal(setupReady(registered,{...sync,state:'syncing'},'Sai'),false);
  assert.equal(setupReady({registrationState:'failed'},sync,'Sai'),false);
  assert.equal(setupReady(registered,sync,'Other'),false);
});
