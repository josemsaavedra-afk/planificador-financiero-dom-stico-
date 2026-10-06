import test,{beforeEach,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createSqlTreasuryBackend} from '../src/treasury/sql-persistence.js';
import {createTreasuryPersistence} from '../src/treasury/persistence.js';
import {parseStatementCsv} from '../src/treasury/statement-csv.js';
import {reconcileStatement} from '../src/treasury/reconciliation.js';
import {createReviewSession,selectReviewCandidate,decideReview} from '../src/treasury/reconciliation-review.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const csv='Fecha;Concepto;Importe\n2026-09-19;Compra;-10\n2026-09-19;Compra;-10';
let db,port,backend,context,actor,failLine,loseResponse;
beforeEach(async()=>{
 db=new PGlite();await db.exec(readFileSync('database/tests/treasury_fixture.sql','utf8'));await db.exec(readFileSync('database/proposals/alpha16_prerc_up.sql','utf8'));
 context={userId:id(1),householdId:id(11)};actor=id(1);failLine=false;loseResponse=false;
 backend=createSqlTreasuryBackend({transaction:async fn=>{
   let lines=0;const result=await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return fn({query:async(sql,args)=>{if(failLine&&sql.startsWith('insert into public.bank_statement_lines')&&++lines===2)throw Error('Interrupción ficticia');return tx.query(sql,args);}});});
   if(loseResponse){loseResponse=false;throw Error('Respuesta perdida después de commit');}return result;
 }});
 port=createTreasuryPersistence({enabled:true,backend,getContext:()=>context});
});
afterEach(async()=>db.close());
const imported=()=>port.execute('import',{accountId:id(101),fileName:'ficticio.csv',csv});
const confirm=(line,patch={})=>port.execute('confirm',{id:id(501),statementLineId:line,seriesId:id(201),occurrenceDate:'2026-09-19',...patch});
const count=async table=>(await db.query('select count(*)::int n from public.'+table)).rows[0].n;

test('CSV → importación → matching → revisión → confirmación → lectura → revocación auditable',async()=>{
 const original=(await db.query('select * from public.movement_series order by id')).rows;
 const batch=await imported();assert.equal(batch.lines.length,2);assert.notEqual(batch.lines[0].id,batch.lines[1].id);assert.equal(batch.lines[0].content_sha256,batch.lines[1].content_sha256);
 const candidates=[{id:id(201)+':2026-09-19',date:'2026-09-19',concept:'Compra',signedAmount:-10}];
 let review=createReviewSession(reconcileStatement(parseStatementCsv(csv),candidates));review=selectReviewCandidate(review,'csv-1',candidates[0].id);review=decideReview(review,'csv-1','confirmada');assert.equal(review.rows[0].decision,'confirmada');
 const saved=await confirm(batch.lines[0].id,{confirmed_by:id(2),confirmed_at:'2000-01-01'});
 assert.equal(saved.confirmed_by,id(1));assert.ok(new Date(saved.confirmed_at).getUTCFullYear()>2000);
 assert.equal((await port.execute('read',{})).length,1);
 const revoked=await port.execute('revoke',{id:saved.id,reason:'Corrección ficticia'});assert.equal(revoked.status,'revoked');assert.equal(revoked.revoked_by,id(1));
 assert.equal(new Date(revoked.confirmed_at).getTime(),new Date(saved.confirmed_at).getTime());
 assert.deepEqual((await db.query('select * from public.movement_series order by id')).rows,original);
});
test('importación y checkpoint son idempotentes; datos distintos provocan conflicto',async()=>{
 const a=await imported(),b=await imported();assert.equal(a.import.id,b.import.id);assert.equal(await count('bank_statement_imports'),1);assert.equal(await count('bank_statement_lines'),2);
 const draft={accountId:id(101),amount:'100',date:'2026-09-18'};
 const cp=await port.execute('checkpoint',draft);assert.equal((await port.execute('checkpoint',draft)).id,cp.id);
 await assert.rejects(()=>port.execute('checkpoint',{...draft,amount:'101'}),/Conflicto/);assert.equal(await count('account_balance_checkpoints'),1);
});
test('fallo a mitad de importación revierte todo y el reintento no duplica líneas',async()=>{
 failLine=true;await assert.rejects(imported,/Interrupción/);assert.equal(await count('bank_statement_imports'),0);assert.equal(await count('bank_statement_lines'),0);
 failLine=false;await imported();assert.equal(await count('bank_statement_lines'),2);
});
test('respuesta perdida tras commit permite reconstruir y reintentar sin doble confirmación',async()=>{
 const batch=await imported();loseResponse=true;await assert.rejects(()=>confirm(batch.lines[0].id),/Respuesta perdida/);
 port=createTreasuryPersistence({enabled:true,backend,getContext:()=>context});const replay=await confirm(batch.lines[0].id);
 assert.equal(replay.id,id(501));assert.equal(await count('treasury_reconciliations'),1);
 await assert.rejects(()=>confirm(batch.lines[1].id),/Conflicto/);
 await port.execute('revoke',{id:id(501),reason:'Corrección'});const again=await port.execute('revoke',{id:id(501),reason:'Corrección'});assert.equal(again.status,'revoked');
 await assert.rejects(()=>confirm(batch.lines[0].id),/Conflicto/);await assert.rejects(()=>port.execute('revoke',{id:id(501),reason:'Reescribir'}),/Conflicto/);
});
test('hogar, cuenta, serie, ocurrencia y actor manipulados no dejan confirmaciones parciales',async()=>{
 await assert.rejects(()=>port.execute('import',{accountId:id(102),csv}),/Cuenta no accesible/);
 const batch=await imported();
 for(const patch of [{seriesId:id(202)},{occurrenceDate:'2026-09-21'}])await assert.rejects(()=>confirm(batch.lines[0].id,patch));
 context={userId:id(2),householdId:id(12)};await assert.rejects(()=>port.execute('read',{}),/Actor/);
 context={userId:id(1),householdId:id(12)};await assert.rejects(()=>port.execute('read',{}),/revocado/);
 assert.equal(await count('treasury_reconciliations'),0);
});
test('revocación de membresía bloquea sincronización posterior sin perder el borrador',async()=>{
 const queue=[{operation:'import',payload:{accountId:id(101),csv}}];
 await db.query('delete from public.household_members where user_id=$1',[id(1)]);
 await assert.rejects(()=>port.execute(queue[0].operation,queue[0].payload),/revocado/);assert.equal(queue.length,1);assert.equal(await count('bank_statement_imports'),0);
 await db.query('insert into public.household_members values($1,$2)',[id(11),id(1)]);
 await port.execute(queue[0].operation,queue[0].payload);queue.shift();assert.equal(queue.length,0);assert.equal(await count('bank_statement_lines'),2);
});
test('CSV corrupto o importación incompleta detectada no se acepta como éxito',async()=>{
 await assert.rejects(()=>port.execute('import',{accountId:id(101),csv:'Fecha;Concepto;Importe\n2026-02-30;X;-10'}),/fecha/);assert.equal(await count('bank_statement_imports'),0);
 await imported();await db.exec('delete from public.bank_statement_lines');await assert.rejects(imported,/Conflicto/);
});
