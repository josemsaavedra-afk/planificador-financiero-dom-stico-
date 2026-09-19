import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source=readFileSync(new URL('../sw.js',import.meta.url),'utf8');
function worker(base='/domus-3/') {
 const events={},deleted=[],added=[];
 const context={URL,Request,importScripts(){},self:{location:{href:'https://example.invalid'+base+'sw.js'},DOMUS3_BUILD:30015,DOMUS3_ASSETS:['index.html'],addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{keys:async()=>['domus-258','planificador-1','domus3:/domus-3/:old','domus3:/other/domus-3/:old'],delete:async key=>deleted.push(key),open:async()=>({addAll:async requests=>added.push(...requests),match:async()=>({status:200})})},fetch:async()=>({status:200})};
 runInNewContext(source,context);return {events,deleted,added};
}
test('worker limpia solo su namespace y precachea URLs usadas realmente',async()=>{
 const w=worker();let pending;w.events.install({waitUntil:p=>pending=p});await pending;
 assert.equal(w.added[0].url,'https://example.invalid/domus-3/index.html');
 w.events.activate({waitUntil:p=>pending=p});await pending;
 assert.deepEqual(w.deleted,['domus3:/domus-3/:old']);
});
test('no instala worker en raíz ni intercepta aplicaciones o APIs ajenas',async()=>{
 const w=worker('/');let pending;w.events.install({waitUntil:p=>pending=p});await assert.rejects(pending,/directorio independiente/);
 for(const url of ['https://example.invalid/index-258.html','https://backend.invalid/rest/v1/accounts','https://example.invalid/domus-3/private.json'])worker().events.fetch({request:{url,method:'GET'},respondWith(){assert.fail('unexpected interception');}});
});
test('manifest tiene identidad, inicio y scope propios; HTML no usa storage legacy',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../manifest.webmanifest',import.meta.url),'utf8'));
 assert.equal(manifest.id,'./');assert.equal(manifest.scope,'./');assert.match(manifest.start_url,/index.html/);assert.doesNotMatch(manifest.start_url,/258/);
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 assert.match(html,/domus3-auth:/);assert.match(html,/domus3-offline:/);assert.doesNotMatch(html,/indexedDB.open\('planificador-offline'/);
 assert.match(html,/op.user_id===ownerId&&op.household_id===hid/);
});
