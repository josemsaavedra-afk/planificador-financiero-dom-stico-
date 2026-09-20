import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fixture(insert) {
  const ops=[{qid:1,user_id:'a',household_id:'h',kind:'insert',table:'fixture',row:{id:1}}];
  const ctx={user:{id:'a'},household:{id:'h'},navigator:{onLine:true},syncQueueError:'',console:{warn(){}},
    queuedOps:async()=>ops.slice(),removeQueued:async()=>ops.shift(),updateSyncBadge:async()=>{},isNetworkError:()=>false,sb:{from:()=>({insert})}};
  runInNewContext(['let offlineFlush=null;',...html.split('\n').filter(s=>s.startsWith('function flushOfflineQueue()')||s.startsWith('async function performOfflineFlush()'))].join('\n'),ctx);
  return {ctx,ops};
}
test('una colisión de unicidad conserva la operación y expone el conflicto',async()=>{
  const f=fixture(async()=>({error:{code:'23505',message:'Conflicto ficticio'}}));
  assert.equal(await f.ctx.flushOfflineQueue(),false);assert.equal(f.ops.length,1);assert.equal(f.ctx.syncQueueError,'Conflicto ficticio');
});
test('dos sincronizaciones simultáneas comparten envío y no duplican mutaciones',async()=>{
  let calls=0,finish,signal;const started=new Promise(resolve=>signal=resolve);const f=fixture(()=>{calls++;signal();return new Promise(resolve=>finish=resolve);});
  const a=f.ctx.flushOfflineQueue(),b=f.ctx.flushOfflineQueue();await started;assert.equal(calls,1);
  finish({error:null});assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(f.ops.length,0);
});
test('un cambio de hogar antes del envío conserva la operación sin enviarla',async()=>{
  const f=fixture(()=>assert.fail('foreign context sent'));f.ctx.household={id:'other'};
  assert.equal(await f.ctx.flushOfflineQueue(),false);assert.equal(f.ops.length,1);
});
test('fallo de IndexedDB no se interpreta como cola vacía sincronizada',async()=>{
 const f=fixture(()=>assert.fail('no send'));f.ctx.queuedOps=async()=>{throw Error('IndexedDB corrupto');};
 assert.equal(await f.ctx.flushOfflineQueue(),false);assert.match(f.ctx.syncQueueError,/cola local/);assert.equal(f.ops.length,1);
});
test('snapshot incompleto, de otra cuenta o con filas de otro hogar se rechaza',()=>{
 const ctx={};runInNewContext(html.split('\n').find(s=>s.startsWith('function validOfflineSnapshot(')),ctx);
 const valid={user_id:'a',household:{id:'h'},membership:{member:{user_id:'a',household_id:'h'}},people:[],accounts:[{household_id:'h'}],categories:[],documents:[],series:[],states:[],members:[],onlogistOperations:[],movementLinks:[]};
 assert.equal(ctx.validOfflineSnapshot(valid,'a'),true);
 for(const patch of [{states:'broken'},{states:[null]},{user_id:'b'},{accounts:[{household_id:'foreign'}]},{membership:null}])assert.equal(Boolean(ctx.validOfflineSnapshot({...valid,...patch},'a')),false);
});
