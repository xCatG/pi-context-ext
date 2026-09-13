import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const data=JSON.parse(fs.readFileSync(new URL('../results/subtraction-v2.json',import.meta.url)));
const cells=data.cells;
assert.equal(cells.length,10);assert.equal(new Set(cells.map(c=>c.id)).size,10);
for(const c of cells){
 assert.equal(c.input+c.output,c.totalKnown);assert.equal(c.cached+c.uncached,c.input);
 assert.ok(c.reasoning<=c.output);assert.equal(c.calls,c.usageCalls);assert.equal(c.unknown,0);
}
const sum=k=>cells.reduce((n,c)=>n+c[k],0);
assert.equal(sum('calls'),258);assert.equal(sum('denied'),4);assert.equal(sum('totalKnown'),3506414);
assert.equal(sum('conservativeMicroUsd'),317547);assert.equal(data.priorConservativeMicroUsd+sum('conservativeMicroUsd'),3047461);
for(const arm of ['A','B'])assert.equal(cells.filter(c=>c.arm===arm&&c.accepted).length,2);
assert.deepEqual(cells.filter(c=>c.prunedRequests).map(c=>c.id).sort(),['M3-W6-B','M7-W6-B']);
for(const r of data.directReplay)assert.equal(r.original-r.transformed,r.proxySaved);
const provenance=JSON.parse(fs.readFileSync(new URL('../experiments/subtraction-v2/SOURCE-PROVENANCE.json',import.meta.url)));
for(const r of provenance){const content=fs.readFileSync(new URL('../experiments/subtraction-v2/'+r.published,import.meta.url));assert.equal(createHash('sha256').update(content).digest('hex'),r.publishedSha256);}
console.log('Ten-cell subtraction arithmetic and exported source hashes verified; private trace judgments are not independently reproduced.');
