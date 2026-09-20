import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createAuthVerifier,createTreasuryHttpHandler} from '../server/treasury-http.js';
import {createPostgresTransaction} from '../server/treasury-postgres.js';
const id='00000000-0000-4000-8000-000000000001',origin='https://isolated.example.invalid';
const request=(patch={})=>new Request(origin+'/domus-3/api/treasury',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-token'},body:JSON.stringify({actorId:id,householdId:'00000000-0000-4000-8000-000000000011',operation:{type:'read'}}),...patch});

test('server auth: SDK real getUser consulta Auth con token explícito y devuelve solo identidad',async()=>{
 let calls=0;const client=createClient('https://fixture.example.invalid','sb_publishable_fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:async(url,options)=>{calls++;assert.equal(String(url),'https://fixture.example.invalid/auth/v1/user');assert.equal(new Headers(options.headers).get('authorization'),'Bearer fixture-token');return new Response(JSON.stringify({id,aud:'authenticated',role:'authenticated',user_metadata:{household_id:'forged'}}),{headers:{'Content-Type':'application/json'}});}}});
 assert.deepEqual(await createAuthVerifier({authClient:client})(request()),{userId:id});assert.equal(calls,1);
});
test('server auth: cabecera ausente/ambigua, token rechazado y usuario anónimo fallan cerrados',async()=>{
 let calls=0;const verify=createAuthVerifier({authClient:{auth:{getUser:async()=>{calls++;return {error:{status:401}};}}}});
 for(const authorization of ['', 'Basic fixture','Bearer x, Bearer y'])await assert.rejects(()=>verify(request({headers:{authorization}})),e=>e.code==='UNAUTHORIZED');assert.equal(calls,0);
 await assert.rejects(()=>verify(request()),e=>e.code==='UNAUTHORIZED');
 await assert.rejects(()=>createAuthVerifier({authClient:{auth:{getUser:async()=>({data:{user:{id,is_anonymous:true}}})}}})(request()),e=>e.code==='UNAUTHORIZED');
});
test('server auth: timeout y fallo temporal no se convierten en usuario autenticado',async()=>{
 for(const getUser of [async()=>({error:{status:503}}),async()=>({error:{status:0}}),async()=>new Promise(()=>{})])await assert.rejects(()=>createAuthVerifier({authClient:{auth:{getUser}},timeoutMs:5})(request()),e=>e.code==='BACKEND_UNAVAILABLE');
});
test('HTTP: flag OFF no ejecuta autenticación ni SQL; strings no activan',async()=>{
 for(const enabled of [undefined,false,'true']){const handler=createTreasuryHttpHandler({enabled,origin,authenticate:()=>{throw Error('must not authenticate');},transaction:()=>{throw Error('must not write');}});const response=await handler(request());assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).error.code,'DISABLED');}
});
test('HTTP: rechaza método, origen cruzado, ruta y JSON/tamaño antes de SQL',async()=>{
 const handler=createTreasuryHttpHandler({enabled:true,origin,maxBytes:250,authenticate:async()=>({userId:id}),transaction:()=>{throw Error('raw secret SQL');}});
 assert.equal((await handler(new Request(origin+'/domus-3/api/treasury'))).status,405);
 assert.equal((await handler(request({headers:{origin:'https://other.invalid'}}))).status,401);
 assert.equal((await handler(new Request(origin+'/other',{method:'POST'}))).status,404);
 for(const body of ['{','x'.repeat(251),JSON.stringify({actorId:id,operation:null}),JSON.stringify({actorId:id,secret:'forbidden',operation:{type:'read'}})]){const response=await handler(request({body}));assert.equal(response.status,400);assert.doesNotMatch(await response.text(),/raw secret/);}
});
test('HTTP: cuerpo sin Content-Length no evade límite; stream detenido tiene timeout',async()=>{
 const handler=createTreasuryHttpHandler({enabled:true,origin,maxBytes:20,bodyTimeoutMs:5,authenticate:async()=>({userId:id}),transaction:()=>{throw Error('SQL');}});
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(21));},cancel(){cancelled=true;}});
 assert.equal((await handler(request({body,duplex:'half'}))).status,400);assert.ok(cancelled);
 const stalled=new ReadableStream({});assert.equal((await handler(request({body:stalled,duplex:'half'}))).status,503);
});
function poolFixture(failSql){const statements=[],released=[];const client={query:async(sql,params)=>{statements.push([sql,params]);if(failSql?.(sql))throw Error('fixture failure');return {rows:sql.startsWith('select current_user')?[{name:'domus_treasury_executor',rolsuper:false,rolbypassrls:false}]:[]};},release:error=>released.push(error)};return {statements,released,client,pool:{connect:async()=>client}};}
test('pool: una conexión y contexto LOCAL parametrizado; commit y release únicos',async()=>{
 const f=poolFixture();assert.equal(await createPostgresTransaction(f)({userId:id},async tx=>{await tx.query('select fixture');return 42;}),42);assert.equal(f.statements[0][0],'BEGIN');assert.equal(f.statements.at(-1)[0],'COMMIT');assert.equal(f.released.length,1);assert.equal(f.released[0],undefined);assert.deepEqual(f.statements.find(([sql])=>sql.includes('set_config'))[1],[id]);
});
test('pool: fallo intermedio hace rollback; fallo de rollback descarta conexión',async()=>{
 for(const failRollback of [false,true]){const f=poolFixture(sql=>sql==='select fixture'||(failRollback&&sql==='ROLLBACK'));await assert.rejects(()=>createPostgresTransaction(f)({userId:id},tx=>tx.query('select fixture')));assert.equal(f.statements.at(-1)[0],'ROLLBACK');assert.equal(f.released.length,1);assert.equal(Boolean(f.released[0]),failRollback);assert.ok(!f.statements.some(([sql])=>sql==='COMMIT'));}
});
test('pool: identidades inválidas no adquieren conexión y rol inseguro no ejecuta dominio',async()=>{
 const f=poolFixture();await assert.rejects(()=>createPostgresTransaction(f)({userId:'invalid'},()=>{}));assert.equal(f.statements.length,0);
 f.client.query=async sql=>({rows:sql.startsWith('select current_user')?[{name:'domus_treasury_executor',rolsuper:true,rolbypassrls:false}]:[]});let worked=false;await assert.rejects(()=>createPostgresTransaction(f)({userId:id},()=>worked=true),e=>e.code==='UNAUTHORIZED');assert.equal(worked,false);assert.equal(f.released.length,1);
});
test('pool: conexión perdida durante COMMIT deja resultado desconocido reintentable',async()=>{
 const f=poolFixture(sql=>sql==='COMMIT'||sql==='ROLLBACK');await assert.rejects(()=>createPostgresTransaction(f)({userId:id},async()=>42),e=>e.code==='BACKEND_UNAVAILABLE');assert.equal(f.released.length,1);assert.ok(f.released[0]);
});
