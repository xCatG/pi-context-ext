import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir=new URL('../visualizations/context-shapes/',import.meta.url);
const data=JSON.parse(fs.readFileSync(new URL('data.json',dir)));
const keys=(o,allowed)=>assert.deepEqual(Object.keys(o).sort(),[...allowed].sort());
const numeric=n=>assert.ok(n===null||(Number.isFinite(n)&&n>=0));
const old=JSON.parse(fs.readFileSync(new URL('../results/aggregate.json',import.meta.url))).cells;
const final=JSON.parse(fs.readFileSync(new URL('../results/subtraction-v2.json',import.meta.url))).cells;
assert.equal(data.runs.length,46);assert.equal(new Set(data.runs.map(r=>r.key)).size,46);
let attempts=0,pruned=0;
for(const r of data.runs){
 keys(r,['key','id','phase','model','task','arm','completed','grade','compactions','calls']);
 assert.match(r.id,/^M[134567]-W[1-6]-[AB]$/);assert.ok(['original','subtraction'].includes(r.phase));
 for(const c of r.calls){attempts++;keys(c,['ordinal','stage','input','output','cached','reasoning','seconds','status','parts','hist','bank','projection','wire']);
  for(const k of ['ordinal','input','output','cached','reasoning','seconds'])numeric(c[k]);
  assert.ok(['stage0','stage1','compact','other'].includes(c.stage));assert.ok(['denied','completed','incomplete','not dispatched','unknown'].includes(c.status));
  if(c.parts){assert.equal(c.parts.length,7);c.parts.forEach(numeric);assert.equal(c.parts.reduce((a,b)=>a+b,0),c.input);}
  if(c.hist){keys(c.hist,['user','assistant','toolResult','other','visible','opaque']);Object.values(c.hist).forEach(numeric);}
  if(c.bank){keys(c.bank,['user_source','observation','claim','work','intent']);Object.values(c.bank).forEach(numeric);}
  if(c.projection){keys(c.projection,['size','omitted','native']);Object.values(c.projection).forEach(numeric);}
  if(c.wire){keys(c.wire,['items','samePrefix','configSame']);numeric(c.wire.samePrefix);assert.ok([null,true,false].includes(c.wire.configSame));
   for(const i of c.wire.items){keys(i,['role','bytes','pruned']);assert.ok(['user','assistant','system','developer','tool result','tool call','reasoning','other'].includes(i.role));numeric(i.bytes);assert.equal(typeof i.pruned,'boolean');}
   if(c.wire.items.some(i=>i.pruned))pruned++;
  }
 }
 const total=r.calls.reduce((s,c)=>s+(c.input??0)+(c.output??0),0);
 const published=r.phase==='original'?old.find(c=>c.cohort==='pilot'&&c.id===r.id):final.find(c=>c.id===r.id);
 assert.ok(published);assert.equal(total,r.phase==='original'?published.knownLogicalTokens:published.totalKnown,r.key+' totals');
 if(r.phase==='subtraction'){assert.equal(r.calls.filter(c=>c.wire).length,published.calls);assert.equal(r.calls.filter(c=>c.wire?.items.some(i=>i.pruned)).length,published.prunedRequests);}
}
assert.equal(attempts,1242);assert.equal(pruned,16);
const template=fs.readFileSync(new URL('template.html',dir),'utf8'),html=fs.readFileSync(new URL('index.html',dir),'utf8');
assert.equal(html,template.replace('/*__DATA__*/',JSON.stringify(data).replaceAll('<','\\u003c')));
assert.ok(!html.includes('fetch('));assert.ok(!html.includes('<script src='));
console.log(`Verified allowlisted viewer schema, published totals, ${attempts} attempts, ${pruned} pruned requests, and reproducible standalone build.`);
