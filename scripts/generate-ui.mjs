import {readFile,writeFile,mkdir} from 'node:fs/promises';
const files=['index.html','app.js','styles.css','integration.js'];
const assets={};
for(const file of files)assets[file]=await readFile(new URL('../ui/'+file,import.meta.url),'utf8');
await mkdir(new URL('../server/',import.meta.url),{recursive:true});
await writeFile(new URL('../server/assets.mjs',import.meta.url),'export const assets='+JSON.stringify(assets)+';\n');
