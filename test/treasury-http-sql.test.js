import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createTreasuryService} from '../server/treasury-service.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,origin='https://isolated.example.invalid';
let db,handler,actor,released;
beforeEach(async()=>{
 db=new PGlite();for(const file of ['database/tests/treasury_fixture.sql','database/proposals/alpha16_prerc_up.sql','database/proposals/alpha18_runtime_up.sql'])await db.exec(readFileSync(file,'utf8'));
 actor=id(1);released=0;
 const authClient={auth:{getUser:async token=>token==='fixture-token'?{data:{user:{id:actor}}}:{error:{status:401}}}};
 const pool={connect:async()=>({query:(sql,args)=>db.query(sql,args),release:()=>released++})};
 handler=createTreasuryService({enabled:true,origin,authClient,pool});
});
afterEach(async()=>db.close());
const op=(patch={})=>({id:id(700),idempotencyKey:id(700),type:'checkpoint',payload:{accountId:id(101),amount:'100',date:'2026-09-18'},baseRevision:null,...patch});
const send=(operation,extra={})=>handler(new Request(origin+'/domus-3/api/treasury',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fixture-token'},body:JSON.stringify({actorId:actor,householdId:id(11),operation,...extra})}));
test('HTTP + SQL: respuesta serializada y replay producen un saldo, actor verificado y un recibo',async()=>{
 const a=await send(op()),b=await send(op());assert.equal(a.status,200);assert.deepEqual(await a.json(),await b.json());assert.equal((await db.query('select count(*)::int n from public.account_balance_checkpoints')).rows[0].n,1);assert.equal((await db.query('select actor_id from private.treasury_operation_receipts')).rows[0].actor_id,id(1));assert.equal(released,2);
 assert.equal((await db.query("select current_setting('request.jwt.claim.sub',true) as actor")).rows[0].actor,'');
});
test('HTTP + SQL: rechazo de actor/hogar, conflicto 409 y ningún detalle SQL en respuesta',async()=>{
 assert.equal((await send(op(),{actorId:id(2)})).status,401);assert.equal(released,0);
 assert.equal((await send(op(),{householdId:id(12)})).status,403);
 await send(op());const response=await send(op({payload:{accountId:id(101),amount:'101',date:'2026-09-18'}}));assert.equal(response.status,409);const body=await response.json();assert.equal(body.error.code,'DUPLICATE_OPERATION');assert.doesNotMatch(JSON.stringify(body),/insert into|constraint|pg_/);
});
test('HTTP + SQL: membresía revocada impide replay y lectura; no reutiliza identidad de conexión',async()=>{
 await send(op());await db.query('delete from public.household_members where user_id=$1',[id(1)]);assert.equal((await send(op())).status,403);
 actor=id(2);const response=await send({type:'read'},{householdId:id(12)});assert.equal(response.status,200);assert.equal((await response.json()).value.checkpoints.length,0);
});
test('HTTP + SQL: importación fallida no deja recibo ni entidades parciales y libera conexión',async()=>{
 const response=await send(op({type:'import',payload:{accountId:id(101),csv:'Fecha;Concepto;Importe\n2026-02-30;X;-10'}}));assert.equal(response.status,400);assert.equal((await db.query('select count(*)::int n from private.treasury_operation_receipts')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from public.bank_statement_imports')).rows[0].n,0);assert.equal(released,0);
 // Domain validation inside SQL fails after acquisition and must roll back/release.
 const bad=await send(op({payload:{accountId:id(101),amount:'100',date:'2999-01-01'}}));assert.equal(bad.status,409);assert.equal(released,1);assert.equal((await db.query('select count(*)::int n from private.treasury_operation_receipts')).rows[0].n,0);
});
