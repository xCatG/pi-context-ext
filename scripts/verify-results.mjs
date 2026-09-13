import fs from 'node:fs';
import assert from 'node:assert/strict';
const data=JSON.parse(fs.readFileSync(new URL('../results/aggregate.json',import.meta.url)));
const expected={M1:[3343126,7818335],M3:[1011611,1248984],M4:[675766,831992]};
for(const [model,totals] of Object.entries(expected)){
  const actual=['A','B'].map(arm=>data.cells.filter(c=>c.cohort==='pilot'&&c.modelSlot===model&&c.arm===arm).reduce((sum,c)=>{assert.notEqual(c.knownLogicalTokens,null);return sum+c.knownLogicalTokens;},0));
  assert.deepEqual(actual,totals);console.log(model,JSON.stringify(actual));
}
assert.equal(data.offline.sessions,29);assert.equal(data.offline.prefixes,1668);assert.equal(data.offline.liveGatePassed,false);
assert.ok(data.offline.cells.every(c=>c.reduction===0));
console.log('Published aggregate arithmetic verified; this does not validate underlying private traces.');
