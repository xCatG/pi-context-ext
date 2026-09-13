import fs from 'node:fs';
const dir=new URL('../visualizations/context-shapes/',import.meta.url);
const data=JSON.parse(fs.readFileSync(new URL('data.json',dir)));
const template=fs.readFileSync(new URL('template.html',dir),'utf8');
const html=template.replace('/*__DATA__*/',JSON.stringify(data).replaceAll('<','\\u003c'));
fs.writeFileSync(new URL('index.html',dir),html);
console.log(`Built standalone viewer: ${data.runs.length} runs, ${Buffer.byteLength(html)} bytes`);
