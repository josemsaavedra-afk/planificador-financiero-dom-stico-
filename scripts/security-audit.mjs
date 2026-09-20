import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const runtime=['index.html','config.js','sw.js','manifest.webmanifest',...readdirSync('src/treasury').filter(f=>f.endsWith('.js')).map(f=>'src/treasury/'+f)];
const forbidden=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/sb_secret_[A-Za-z0-9_-]+/,/service_role/,/https:\/\/[a-z0-9-]+\.supabase\.co/,/console\.log\(/];
for(const file of runtime){const source=readFileSync(file,'utf8');for(const pattern of forbidden)assert.doesNotMatch(source,pattern,'Runtime security gate: '+file);}
// Only counts/locations are emitted, never matched token/key values.
const categories={runtime:[],historical:[],testTools:[],documentation:[]};
function walk(dir='.') {for(const entry of readdirSync(dir,{withFileTypes:true})){
 if(['.git','node_modules','dist','artifacts','.codex','.agents'].includes(entry.name))continue;
 const name=(dir==='.'?'':dir+'/')+entry.name;if(entry.isDirectory()){walk(name);continue;}
 if(!/\.(?:js|mjs|html|json|md|sql|yaml)$/.test(name))continue;
 const matches=readFileSync(name,'utf8').split(/\r?\n/).flatMap((line,i)=>/TODO|FIXME|TEMP|DEBUG|console\.log|localhost|127\.0\.0\.1|service_role|https?:\/\//.test(line)?[i+1]:[]);
 if(matches.length){const group=runtime.includes(name)?'runtime':/^(test|scripts|database\/tests)\//.test(name)?'testTools':/\.md$/.test(name)?'documentation':'historical';categories[group].push({file:name,lines:matches});}
}}
walk();console.log(JSON.stringify({securityGate:'PASS',runtimeFiles:runtime.length,occurrences:categories},null,2));
