import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import assert from 'node:assert/strict';
const read=file=>readFileSync(file,'utf8');
const files=['sw.js','config.js'];
for(const dir of ['src/treasury','test','scripts'])for(const name of readdirSync(dir))if(/\.m?js$/.test(name))files.push(dir+'/'+name);
for(const file of files)execFileSync(process.execPath,['--check',file]);
const html=read('index.html');let inline=0;
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!match[1].includes('src=')&&match[2].trim()){new Script(match[2]);inline++;}
const version=JSON.parse(read('version.json')),pkg=JSON.parse(read('package.json')),manifest=JSON.parse(read('manifest.webmanifest'));
assert.equal(pkg.version,version.version);assert.ok(html.includes(`APP_BUILD='${version.build}'`));
assert.equal(manifest.scope,'./');assert.equal(manifest.id,'./');
for(const file of ['config.js','index.html','sw.js','manifest.webmanifest',...files.filter(f=>f.startsWith('src/'))])assert.doesNotMatch(read(file),/localhost|127\.0\.0\.1|index-258\.html|TODO|FIXME/);
const built=read('dist/domus-3/asset-manifest.js');const context={self:{}};new Script(built).runInNewContext(context);
assert.equal(context.self.DOMUS3_BUILD,version.build);
const allowed=new Set([...context.self.DOMUS3_ASSETS,'asset-manifest.js','sw.js']);
function inspect(dir,relative='') {for(const entry of readdirSync(dir,{withFileTypes:true})){const name=relative+entry.name;if(entry.isDirectory())inspect(dir+'/'+entry.name,name+'/');else {assert.ok(allowed.has(name),'Unexpected packaged file: '+name);allowed.delete(name);}}}
inspect('dist/domus-3');assert.equal(allowed.size,0,'Missing packaged assets');
assert.equal(read('dist/domus-3/index.html'),html,'Stale build');
console.log(`PASS: ${files.length} JS files, ${inline} inline script, JSON/version consistency, runtime routes and exact PWA package inventory.`);
