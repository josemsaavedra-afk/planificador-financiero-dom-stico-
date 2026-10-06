import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createTransactionalTreasuryBackend,createTreasuryRequestHandler} from '../src/treasury/transactional-backend.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const csv='Fecha;Concepto;Importe\n2026-09-19;Compra;-10\n2026-09-19;Compra;-10';
let db,backend,context,actor,loseResponse,failAt,next;
beforeEach(async()=>{
 db=new PGlite();for(const file of ['database/tests/treasury_fixture.sql','database/proposals/alpha16_prerc_up.sql','database/proposals/alpha18_runtime_up.sql'])await db.exec(readFileSync(file,'utf8'));
 context={userId:id(1),householdId:id(11)};actor=id(1);loseResponse=false;failAt=null;next=700;
 backend=createTransactionalTreasuryBackend({transaction:async fn=>{
   let lines=0;const result=await db.transaction(async tx=>{await tx.exec('set local role domus_treasury_executor');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return fn({query:async(sql,args)=>{
     if((failAt==='line'&&sql.startsWith('insert into public.bank_statement_lines')&&++lines===2)||(failAt==='receipt'&&sql.startsWith('insert into private.treasury_operation_receipts')))throw Error('Fallo aislado');
     return tx.query(sql,args);
   }});});if(loseResponse){loseResponse=false;throw new TypeError('Lost response');}return result;
 }});
});
afterEach(async()=>db.close());
const operation=(type,payload,baseRevision=null)=>{const key=id(next++);return {id:key,idempotencyKey:key,type,payload,baseRevision};};
const send=op=>backend.execute(op,context);
const load=()=>send({type:'read'});
const imported=()=>send(operation('import',{accountId:id(101),csv}));
async function confirmation(){const batch=await imported();return operation('confirm',{id:id(501),accountId:id(101),statementLineId:batch.lines[0].id,seriesId:id(201),occurrenceDate:'2026-09-19'},{series:1,occurrence:1,lineHash:batch.lines[0].content_sha256});}
const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
const rejects=(fn,code)=>assert.rejects(fn,error=>error.code===code);

test('SQL runtime: import/checkpoint/confirm/revoke perdidos se repiten con el mismo recibo',async()=>{
 const batchOp=operation('import',{accountId:id(101),csv});loseResponse=true;await rejects(()=>send(batchOp),'BACKEND_UNAVAILABLE');const batch=await send(batchOp);assert.deepEqual(await send(batchOp),batch);
 const checkpoint=operation('checkpoint',{accountId:id(101),amount:'100',date:'2026-09-18'});loseResponse=true;await rejects(()=>send(checkpoint),'BACKEND_UNAVAILABLE');const cp=await send(checkpoint);assert.deepEqual(await send(checkpoint),cp);
 const confirm=operation('confirm',{id:id(501),accountId:id(101),statementLineId:batch.lines[0].id,seriesId:id(201),occurrenceDate:'2026-09-19'},{series:1,occurrence:1,lineHash:batch.lines[0].content_sha256});
 loseResponse=true;await rejects(()=>send(confirm),'BACKEND_UNAVAILABLE');const saved=await send(confirm);assert.deepEqual(await send(confirm),saved);
 const revoke=operation('revoke',{id:saved.id,reason:'Corrección'},saved.treasury_revision);loseResponse=true;await rejects(()=>send(revoke),'BACKEND_UNAVAILABLE');const revoked=await send(revoke);assert.deepEqual(await send(revoke),revoked);
 assert.equal(revoked.status,'revoked');assert.equal(revoked.confirmed_at,saved.confirmed_at);assert.equal(revoked.revoked_by,id(1));assert.equal(await count('private.treasury_operation_receipts'),4);assert.equal(await count('public.treasury_reconciliations'),1);
 // The receipt is historical proof, not a claim that the entity is still confirmed.
 assert.equal((await send(confirm)).status,'confirmed');assert.equal((await load()).reconciliations[0].status,'revoked');
});
test('SQL runtime: fallo en segunda línea o en recibo revierte entidades y recibo',async()=>{
 for(const point of ['line','receipt']){failAt=point;await rejects(imported,'INTEGRITY_VIOLATION');assert.equal(await count('public.bank_statement_imports'),0);assert.equal(await count('public.bank_statement_lines'),0);assert.equal(await count('private.treasury_operation_receipts'),0);}
 failAt=null;await imported();assert.equal(await count('public.bank_statement_lines'),2);
});
test('SQL runtime: identidad repetida con distinto contenido no muta el servidor',async()=>{
 const op=operation('checkpoint',{accountId:id(101),amount:'100',date:'2026-09-18'});await send(op);op.payload.amount='101';await rejects(()=>send(op),'DUPLICATE_OPERATION');assert.equal((await load()).checkpoints[0].balance,'100.00');
});
test('SQL runtime: cambios de serie y ocurrencia invalidan revisión; no-op no permite ABA',async()=>{
 const op=await confirmation();await db.query('update public.movement_series set treasury_revision=1 where id=$1',[id(201)]);await rejects(()=>send(op),'STALE_VERSION');
 const state=await load(),source=state.sources.find(s=>s.series_id===id(201));op.baseRevision.series=source.series;
 await db.query('delete from public.movement_occurrence_states where series_id=$1 and occurrence_date=$2',[id(201),'2026-09-19']);await db.query('insert into public.movement_occurrence_states(series_id,occurrence_date) values($1,$2)',[id(201),'2026-09-19']);
 await rejects(()=>send(op),'STALE_VERSION');assert.equal(await count('public.treasury_reconciliations'),0);
});
test('SQL runtime: línea alterada, cuenta cruzada y ocurrencia ausente son conflictos distintos',async()=>{
 const op=await confirmation();await rejects(()=>send({...op,baseRevision:{...op.baseRevision,lineHash:'0'.repeat(64)}}),'SOURCE_CHANGED');
 await rejects(()=>send({...op,payload:{...op.payload,accountId:id(103)}}),'ACCOUNT_MISMATCH');
 await rejects(()=>send({...op,payload:{...op.payload,occurrenceDate:'2026-09-21'}}),'OCCURRENCE_CONFLICT');
 await rejects(()=>send({...op,payload:{...op.payload,seriesId:id(203)}}),'ACCOUNT_MISMATCH');
});
test('SQL runtime: competidores conservan confirmación y revocación originales',async()=>{
 const op=await confirmation(),saved=await send(op);const another=operation('confirm',{...op.payload,id:id(502)},op.baseRevision);await rejects(()=>send(another),'ALREADY_CONFIRMED');
 const state=await load();another.payload.statementLineId=state.lines[1].id;await rejects(()=>send(another),'OCCURRENCE_CONFLICT');
 await rejects(()=>send(operation('revoke',{id:saved.id,reason:'Otro'},saved.treasury_revision+1)),'STALE_VERSION');
 await send(operation('revoke',{id:saved.id,reason:'Corrección'},saved.treasury_revision));await rejects(()=>send(operation('revoke',{id:saved.id,reason:'Otro'},saved.treasury_revision)),'ALREADY_REVOKED');
 await rejects(()=>send(operation('confirm',op.payload,op.baseRevision)),'ALREADY_REVOKED');assert.equal(await count('public.treasury_reconciliations'),1);
});
test('SQL runtime: membresía revocada bloquea incluso recibos; doble miembro no cruza cuentas',async()=>{
 const op=operation('import',{accountId:id(101),csv});await send(op);await db.query('delete from public.household_members where user_id=$1',[id(1)]);await rejects(()=>send(op),'HOUSEHOLD_MISMATCH');
 actor=id(3);context.userId=id(3);context.householdId=id(12);await rejects(()=>send(operation('import',{accountId:id(101),csv})),'ACCOUNT_MISMATCH');assert.equal((await load()).imports.length,0);
 context.householdId=id(11);assert.equal((await load()).imports.length,1);
});
test('SQL runtime: payload y contexto no pueden suplantar autor, fecha ni hogar',async()=>{
 for(const patch of [{created_by:id(2)},{created_at:'2000-01-01'},{household_id:id(12)},{access_token:'fake'}])await rejects(()=>send(operation('checkpoint',{accountId:id(101),amount:'100',date:'2026-09-18',...patch})),'INVALID_PAYLOAD');
 context.userId=id(2);await rejects(()=>load(),'UNAUTHORIZED');context.userId=id(1);
 const cp=await send(operation('checkpoint',{accountId:id(101),amount:'100',date:'2026-09-18'}));assert.equal(cp.created_by,id(1));assert.ok(new Date(cp.created_at).getUTCFullYear()>2000);
});
test('SQL runtime: authenticated no puede falsificar, leer ni borrar recibos; ejecutor mantiene RLS',async()=>{
 await imported();await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id(1)]);await assert.rejects(()=>tx.query('select * from private.treasury_operation_receipts'));});
 const role=(await db.query("select rolsuper,rolbypassrls,rolcanlogin from pg_roles where rolname='domus_treasury_executor'")).rows[0];assert.deepEqual(role,{rolsuper:false,rolbypassrls:false,rolcanlogin:false});
 actor=id(2);context={userId:id(2),householdId:id(12)};assert.equal((await load()).lines.length,0);
});
test('SQL runtime: rollback vacío conserva bases y rollback con recibos rechaza destrucción',async()=>{
 await db.exec(readFileSync('database/proposals/alpha18_runtime_down.sql','utf8'));assert.equal(await count('public.movement_series'),3);
 await db.exec(readFileSync('database/proposals/alpha18_runtime_up.sql','utf8'));await imported();await assert.rejects(()=>db.exec(readFileSync('database/proposals/alpha18_runtime_down.sql','utf8')),/historial/);await db.exec('rollback');assert.equal(await count('private.treasury_operation_receipts'),1);
});
test('SQL runtime: fallo al registrar confirmación o revocación restaura historial completo',async()=>{
 const op=await confirmation();failAt='receipt';await rejects(()=>send(op),'INTEGRITY_VIOLATION');assert.equal(await count('public.treasury_reconciliations'),0);failAt=null;const saved=await send(op);
 failAt='receipt';await rejects(()=>send(operation('revoke',{id:saved.id,reason:'Corrección'},saved.treasury_revision)),'INTEGRITY_VIOLATION');const current=(await load()).reconciliations[0];assert.equal(current.status,'confirmed');assert.equal(current.treasury_revision,saved.treasury_revision);
});
test('SQL runtime: handler autentica antes de aceptar contexto de petición',async()=>{
 const handler=createTreasuryRequestHandler({authenticate:async()=>null,transaction:()=>{throw Error('No debe ejecutarse');}});
 await rejects(()=>handler({body:{userId:id(1),householdId:id(11),operation:{type:'read'}}}),'UNAUTHORIZED');
});
test('SQL runtime: dos solicitudes encoladas del mismo comando crean una entidad y un recibo',async()=>{
 const op=operation('import',{accountId:id(101),csv});const results=await Promise.all([send(op),send(op)]);assert.deepEqual(results[0],results[1]);assert.equal(await count('public.bank_statement_imports'),1);assert.equal(await count('private.treasury_operation_receipts'),1);
});
