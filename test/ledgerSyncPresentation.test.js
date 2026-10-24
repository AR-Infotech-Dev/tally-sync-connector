import test from 'node:test';
import assert from 'node:assert/strict';
import { getSyncPresentation } from '../src/renderer/src/modules/monitor/utils/ledgerSync.js';

test('Sync UI does not announce completion before the verified snapshot is published',()=>{
  assert.equal(getSyncPresentation({state:'syncing',phase:'discovering',total:null,completed:0}).percent,null);
  assert.equal(getSyncPresentation({state:'syncing',phase:'verifying',total:100,completed:100}).percent,99);
  assert.equal(getSyncPresentation({state:'ready',phase:'complete',total:100,completed:100}).percent,100);
  assert.match(getSyncPresentation({state:'failed',phase:'failed'}).label,/failed/i);
});
