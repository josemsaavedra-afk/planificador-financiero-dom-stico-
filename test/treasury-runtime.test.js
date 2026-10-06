import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistenceRuntime} from '../src/treasury/persistence-runtime.js';
import {TreasuryError,classifyError} from '../src/treasury/runtime-contract.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const payload={accountId:id(101),amount:'100',date:'2026-09-18'};
// Unit storage contract. Real IndexedDB/reopen is exercised by the browser suite.
function fixture(options={}) {
 const data=new Map(),store={list:async()=>structuredClone([...data.values()]),get:async key=>structuredClone(data.get(key)),update:async(key,fn)=>{const row=fn(structuredClone(data.get(key)));if(row!==undefined)data.set(key,structuredClone(row));return structuredClone(row);}};
 let context={userId:id(1),householdId:id(11)},time=100000,calls=0;
 const backend={execute:async row=>{calls++;return {id:row.id};}};
 const make=extra=>createPersistenceRuntime({store,backend,enabled:true,getContext:()=>context,now:()=>time,...options,...extra});
 return {data,store,backend,make,get calls(){return calls;},setContext:value=>context=value,tick:ms=>time+=ms};
}
test('runtime: OFF, string true y backend ausente jamás envían',async()=>{
 for(const enabled of [false,'true',undefined]){const f=fixture();const runtime=f.make({enabled});await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();assert.equal(f.calls,0);}
 const f=fixture();await f.make({backend:null}).syncPendingOperations();assert.equal(f.calls,0);
});
test('runtime: guardar antes de enviar, recrear runtime y confirmar conserva identidad',async()=>{
 const f=fixture(),runtime=f.make();const row=await runtime.createCheckpoint(payload);assert.equal(f.calls,0);assert.equal((await f.store.get(row.id)).state,'pending');
 const reopened=f.make();await reopened.syncPendingOperations();assert.equal((await reopened.list())[0].state,'confirmed');assert.equal(f.calls,1);
});
test('runtime: doble submit con identidad estable y doble sync no duplican',async()=>{
 const f=fixture(),runtime=f.make();await Promise.all([runtime.createCheckpoint(payload,{operationId:id(700)}),runtime.createCheckpoint(payload,{operationId:id(700)})]);await Promise.all([runtime.syncPendingOperations(),runtime.syncPendingOperations()]);assert.equal(f.calls,1);assert.equal((await runtime.list()).length,1);
 await assert.rejects(()=>runtime.createCheckpoint({...payload,amount:'101'},{operationId:id(700)}),e=>e.code==='DUPLICATE_OPERATION');
});
test('runtime: dos instancias comparten lease; syncing huérfano se recupera tras caducar',async()=>{
 const f=fixture(),runtime=f.make();const row=await runtime.createCheckpoint(payload);await f.store.update(row.id,r=>({...r,state:'syncing',attempts:1,leaseOwner:'closed-tab',leaseUntil:150000}));
 await f.make().syncPendingOperations();assert.equal(f.calls,0);f.tick(60000);await Promise.all([f.make().syncPendingOperations(),f.make().syncPendingOperations()]);assert.equal(f.calls,1);assert.equal((await runtime.list())[0].attempts,2);
});
test('runtime: backend confirma y pierde respuesta; reabrir reintenta la misma identidad',async()=>{
 const f=fixture(),receipts=new Map();let sends=0;f.backend.execute=async row=>{sends++;if(!receipts.has(row.id)){receipts.set(row.id,{id:row.id});throw new TypeError('lost');}return receipts.get(row.id);};
 const runtime=f.make();await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();assert.equal((await runtime.list())[0].state,'retryable_error');f.tick(1001);await f.make().syncPendingOperations();assert.equal((await runtime.list())[0].state,'confirmed');assert.equal(receipts.size,1);assert.equal(sends,2);
});
test('runtime: backoff y límite bloquean reintentos infinitos incluso tras crash del último intento',async()=>{
 const f=fixture({maxAttempts:2});f.backend.execute=async()=>{throw {status:503};};const runtime=f.make();const row=await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();await runtime.syncPendingOperations();assert.equal((await runtime.list())[0].attempts,1);
 f.tick(1001);await runtime.syncPendingOperations();f.tick(100000);await runtime.syncPendingOperations();assert.equal((await runtime.list())[0].attempts,2);
 await f.store.update(row.id,r=>({...r,state:'syncing',leaseUntil:0}));await f.make().syncPendingOperations();assert.equal((await runtime.list())[0].state,'retryable_error');
});
test('runtime: timeout aborta, preserva payload y permite solo retry con identidad original',async()=>{
 const f=fixture({timeoutMs:5});let aborted=false;f.backend.execute=async(row,ctx,signal)=>new Promise(()=>signal.addEventListener('abort',()=>aborted=true));const runtime=f.make();const row=await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();assert.ok(aborted);assert.equal((await runtime.list())[0].id,row.id);assert.equal((await runtime.list())[0].lastError.code,'BACKEND_UNAVAILABLE');
});
test('runtime: conflictos conservan ambas versiones al reabrir, no auto rebase',async()=>{
 const f=fixture();f.backend.execute=async()=>{throw new TreasuryError('STALE_VERSION',{revision:6});};const runtime=f.make();const row=await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();const recovered=(await f.make().list())[0];assert.equal(recovered.state,'conflict');assert.deepEqual(recovered.payload,payload);assert.deepEqual(recovered.lastError.details,{revision:6});
 await runtime.acknowledgeConflict(row.id);assert.equal((await runtime.list())[0].resolution,'remote_accepted');assert.equal((await runtime.list())[0].state,'conflict');
});
test('runtime: no reintenta automáticamente errores de autorización, integridad o payload',async()=>{
 for(const code of ['UNAUTHORIZED','INVALID_PAYLOAD','INTEGRITY_VIOLATION']){const f=fixture();let calls=0;f.backend.execute=async()=>{calls++;throw new TreasuryError(code);};const runtime=f.make();await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();f.tick(999999);await runtime.syncPendingOperations();assert.equal(calls,1);assert.equal((await runtime.list())[0].state,'permanent_error');}
});
test('runtime: otro hogar, logout y otro usuario no envían ni borran pendientes',async()=>{
 const f=fixture(),runtime=f.make();await runtime.createCheckpoint(payload);f.setContext({userId:id(1),householdId:id(12)});await runtime.syncPendingOperations();assert.equal(f.calls,0);assert.equal((await runtime.list()).length,0);
 f.setContext(null);await assert.rejects(()=>runtime.syncPendingOperations());f.setContext({userId:id(2),householdId:id(11)});await runtime.syncPendingOperations();assert.equal(f.calls,0);
 f.setContext({userId:id(1),householdId:id(11)});assert.equal((await runtime.list()).length,1);await runtime.syncPendingOperations();assert.equal(f.calls,1);
});
test('runtime: cambio de contexto durante almacenamiento impide envío tardío',async()=>{
 const f=fixture(),runtime=f.make();await runtime.createCheckpoint(payload);const original=f.store.update;f.store.update=async(key,fn)=>{const result=await original(key,fn);if(result.state==='syncing')f.setContext({userId:idForUser(),householdId:id(12)});return result;};
 function idForUser(){return id(1);}
 await runtime.syncPendingOperations();assert.equal(f.calls,0);assert.equal([...f.data.values()][0].state,'pending');
});
test('runtime: logout mientras llega recibo lo conserva para su propietario, no para sesión nueva',async()=>{
 const f=fixture(),runtime=f.make();f.backend.execute=async row=>{f.setContext({userId:id(2),householdId:id(12)});return {id:row.id};};await runtime.createCheckpoint(payload);assert.deepEqual(await runtime.syncPendingOperations(),[]);assert.equal((await runtime.list()).length,0);f.setContext({userId:id(1),householdId:id(11)});assert.equal((await runtime.list())[0].state,'confirmed');
});
test('runtime: payload arbitrario, secretos y auditoría falsificada no se almacenan',async()=>{
 const f=fixture(),runtime=f.make();for(const extra of [{access_token:'secret'},{created_by:id(2)},{household_id:id(12)},{created_at:'2000-01-01'}])await assert.rejects(()=>runtime.createCheckpoint({...payload,...extra}),e=>e.code==='INVALID_PAYLOAD');assert.equal(f.data.size,0);
 await assert.rejects(()=>runtime.confirmReconciliation({id:id(501),accountId:id(101),statementLineId:id(401),seriesId:id(201),occurrenceDate:'2026-09-19'}),e=>e.code==='INVALID_PAYLOAD');
});
test('runtime: almacenamiento fallido nunca dispara backend ni oculta pérdida de durabilidad',async()=>{
 const f=fixture();f.store.update=async()=>{throw new TreasuryError('STORAGE_UNAVAILABLE');};await assert.rejects(()=>f.make().createCheckpoint(payload),e=>e.code==='STORAGE_UNAVAILABLE');assert.equal(f.calls,0);
});
test('runtime: clasificación pública no expone mensajes internos ni reintenta errores SQL de integridad',()=>{
 assert.equal(classifyError({code:'23505',message:'SQL internal'}).code,'INTEGRITY_VIOLATION');assert.equal(classifyError({status:401}).code,'UNAUTHORIZED');assert.equal(classifyError({status:503}).code,'BACKEND_UNAVAILABLE');assert.doesNotMatch(classifyError(Error('private password')).message,/password/);
});
test('runtime: reintento explícito tras agotar intentos conserva clave; conflicto nunca se reintenta',async()=>{
 const f=fixture({maxAttempts:1}),runtime=f.make();f.backend.execute=async()=>{throw new TreasuryError('BACKEND_UNAVAILABLE');};const row=await runtime.createCheckpoint(payload);await runtime.syncPendingOperations();await runtime.retryOperation(row.id);assert.equal((await runtime.list())[0].idempotencyKey,row.id);assert.equal((await runtime.list())[0].retryRounds,1);
 f.backend.execute=async()=>{throw new TreasuryError('STALE_VERSION');};await runtime.syncPendingOperations();await assert.rejects(()=>runtime.retryOperation(row.id),e=>e.code==='INVALID_PAYLOAD');
});
