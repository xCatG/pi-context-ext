import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const meta=JSON.parse(fs.readFileSync(new URL('../SOURCE-PROVENANCE.json',import.meta.url)));
for(const f of meta.files)assert.equal(createHash('sha256').update(fs.readFileSync(new URL('../'+f.path,import.meta.url))).digest('hex'),f.sha256);
console.log('Runtime snapshot identity verified; this is not an efficacy test.');
