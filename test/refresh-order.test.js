import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('una lectura antigua del mismo hogar no sobrescribe una sincronización más reciente',async()=>{
 const source=readFileSync('index.html','utf8').split('\n').find(s=>s.startsWith('async function refreshAll()')).replace("await import('./src/treasury/data-loading.js')",'{readAllPages:readAllPagesFixture}');
 let release,signal;const waiting=new Promise(r=>release=r),started=new Promise(r=>signal=r);let renders=0;
 const ctx={refreshRequest:0,user:{id:'a'},household:{id:'h'},navigator:{onLine:true},flushOfflineQueue:async()=>{},saveOfflineSnapshot:async()=>{},updateSyncBadge:async()=>{},renderAll:()=>renders++,console,alert:()=>assert.fail('unexpected alert'),friendlyCloudError:e=>{throw e;},isNetworkError:()=>false};
 ctx.sb={from(table){const request=ctx.refreshRequest;const query={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},maybeSingle(){return this;},async then(resolve){if(request===1){signal();await waiting;}resolve({data:table==='people'?[{name:request===1?'old':'new'}]:[],error:null});}};return query;}};
 ctx.readAllPagesFixture=async create=>await create();
 runInNewContext(source,ctx);const old=ctx.refreshAll();await started;await ctx.refreshAll();release();await old;
 assert.equal(ctx.people[0].name,'new');assert.equal(renders,1);
});
