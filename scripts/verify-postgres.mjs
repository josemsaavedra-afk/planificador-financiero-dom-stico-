// Opt-in: own temporary cluster, or explicitly confirmed EMPTY isolated loopback database.
// Requires initdb, pg_ctl and psql on PATH. No production credentials or external host.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { isolatedPgTarget } from './postgres-target.mjs';
const target=process.env.DATABASE_URL?isolatedPgTarget(process.env.DATABASE_URL,process.env.DOMUS_TEST_DATABASE):null;
for(const command of (target?['psql']:['initdb','pg_ctl','psql']))execFileSync(command,['--version'],{stdio:'pipe'});
const dir=await mkdtemp(path.join(os.tmpdir(),'domus16-pg-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
const env={...process.env,PGHOST:'127.0.0.1',PGHOSTADDR:'',PGSSLMODE:'disable',PGPORT:String(port),PGUSER:'domus_fixture',PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=10000',PGPASSWORD:'',PGSERVICE:'',PGSERVICEFILE:path.join(dir,'no-service'),PGPASSFILE:path.join(dir,'no-password'),PGAPPNAME:'domus18-race',...(target||{})};
function sql(text) {return new Promise((resolve,reject)=>{
 const child=spawn('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',text],{env,windowsHide:true});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
 child.on('close',code=>code===0?resolve(out):reject(new Error(err)));
});}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const asActor=`set local role authenticated;select set_config('request.jwt.claim.sub','${id(1)}',true);`;
let started=false;
try {
 if(!target){execFileSync('initdb',['-D',dir,'--auth=trust','--username=domus_fixture','--no-locale','--encoding=UTF8'],{env,windowsHide:true,stdio:'pipe'});
 execFileSync('pg_ctl',['-D',dir,'-l',path.join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{env,windowsHide:true,stdio:'pipe'});started=true;}else{
 assert.equal((await sql("select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema')")).trim(),'0','Isolated database must be empty');
 assert.equal((await sql("select count(*) from pg_roles where rolname in ('anon','authenticated')")).trim(),'0','Existing auth roles: refuse shared cluster');
 assert.equal((await sql("select count(*) from pg_database where not datistemplate and datname not in ('postgres','"+target.PGDATABASE+"')")).trim(),'0','Refuse a cluster with other databases');
 }
 await sql(await readFile('database/tests/treasury_fixture.sql','utf8'));
 await sql(await readFile('database/proposals/alpha16_prerc_up.sql','utf8'));
 await sql(await readFile('database/proposals/alpha18_runtime_up.sql','utf8'));
 const pids=new Set();
 async function race(first,second,expectDuplicate) {
   // Hold the first transaction until the second backend visibly waits on a lock.
   const a=sql(`begin;${asActor}select 'PID:'||pg_backend_pid();${first};select pg_sleep(2);commit;`);
   a.catch(()=>{});
   let firstReady=false;
   for(let i=0;i<100;i++){if((await sql("select count(*) from pg_stat_activity where application_name='domus18-race' and wait_event='PgSleep'")).trim()==='1'){firstReady=true;break;}await new Promise(r=>setTimeout(r,10));}
   assert.ok(firstReady,'first connection must hold its transaction');
   const b=sql(`begin;${asActor}select 'PID:'||pg_backend_pid();${second};commit;`);b.catch(()=>{});
   let blocked=false;
   for(let i=0;i<100;i++){if(Number((await sql("select count(*) from pg_stat_activity where application_name='domus18-race' and wait_event_type='Lock'")).trim())>0){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
   const results=await Promise.allSettled([a,b]);assert.ok(blocked,'independent backend must actually wait on a lock');
   assert.equal(results[0].status,'fulfilled');
   for(const r of results)if(r.status==='fulfilled')for(const match of r.value.matchAll(/PID:(\d+)/g))pids.add(match[1]);
   if(expectDuplicate){assert.equal(results[1].status,'rejected');assert.match(results[1].reason.message,/duplicate key/i);}
   else assert.equal(results[1].status,'fulfilled');
   return results;
 }
 const cp=`insert into public.account_balance_checkpoints(household_id,account_id,balance_date,balance,source) values('${id(11)}','${id(101)}','2026-09-19',100,'manual')`;
 await race(cp,cp,true);
 await sql(`begin;${asActor}
 insert into public.bank_statement_imports(id,household_id,account_id,file_name,content_sha256,line_count) values('${id(301)}','${id(11)}','${id(101)}','fake.csv','${'a'.repeat(64)}',2);
 insert into public.bank_statement_lines(id,import_id,line_ordinal,transaction_date,concept,signed_amount,content_sha256) values
 ('${id(401)}','${id(301)}',1,'2026-09-19','Igual',-10,'${'b'.repeat(64)}'),
 ('${id(402)}','${id(301)}',2,'2026-09-19','Igual',-10,'${'b'.repeat(64)}');commit;`);
 const confirmation=line=>`insert into public.treasury_reconciliations(household_id,statement_line_id,movement_series_id,occurrence_date) values('${id(11)}','${id(line)}','${id(201)}','2026-09-19')`;
 // Same line, different occurrence (A), then same occurrence, different line (B).
 await race(confirmation(401),confirmation(401).replace('2026-09-19','2026-09-20'),true);
 await sql("begin;"+asActor+"update public.treasury_reconciliations set status='revoked',revoked_by=auth.uid(),revocation_reason='prepare';commit;");
 await race(confirmation(401),confirmation(402),true);
 const revoke="update public.treasury_reconciliations set status='revoked',revoked_by=auth.uid(),revocation_reason='fixture' where status='confirmed' returning 'REVOKED'";
 // C: freeing a unique slot must serialize with a replacement confirmation.
 await race(revoke,confirmation(402),false);
 const revoked=await race(revoke,revoke,false);
 assert.equal(revoked.map(r=>(r.value.match(/^REVOKED$/gm)||[]).length).join(','),'1,0');
 await sql(`begin;${asActor}${confirmation(401)};commit;`);
 await assert.rejects(()=>sql(`update public.movement_series set account_id='${id(103)}' where id='${id(201)}'`),/foreign key/i);
 assert.equal((await sql('select count(*) from public.bank_statement_lines')).trim(),'2');
 const imp="insert into public.bank_statement_imports(household_id,account_id,file_name,content_sha256,line_count) values('"+id(11)+"','"+id(101)+"','race.csv','"+'c'.repeat(64)+"',0)";
 await race(imp,imp,true);
 await assert.rejects(()=>sql('begin;'+asActor+"insert into public.account_balance_checkpoints(household_id,account_id,balance_date,balance,source) values('"+id(11)+"','"+id(101)+"','2026-09-20',77,'manual');"+confirmation(402)+";commit;"),/duplicate key/i);
 assert.equal((await sql("select count(*) from public.account_balance_checkpoints where balance_date='2026-09-20'")).trim(),'0','conflict rolls back entire transaction');
 const ownRead=actor=>sql("begin;set local role authenticated;select set_config('request.jwt.claim.sub','"+id(actor)+"',true);select 'HOUSE:'||household_id from public.accounts;commit;");
 const isolated=await Promise.all([ownRead(1),ownRead(2)]);assert.ok(!isolated[0].includes('HOUSE:'+id(12))&&!isolated[1].includes('HOUSE:'+id(11)));
 await assert.rejects(()=>sql('begin;'+asActor+"insert into public.account_balance_checkpoints(household_id,account_id,balance_date,balance,source,created_by) values('"+id(11)+"','"+id(101)+"','2026-09-20',1,'manual','"+id(2)+"');commit;"),/Autor/i);
 await sql('begin;'+asActor+"insert into public.account_balance_checkpoints(household_id,account_id,balance_date,balance,source,created_at) values('"+id(11)+"','"+id(101)+"','2026-09-20',1,'manual','2000-01-01');commit;");
 assert.equal((await sql("select count(*) from public.account_balance_checkpoints where created_at<'2001-01-01'")).trim(),'0');
 const beforeRevision=Number((await sql("select treasury_revision from public.movement_series where id='"+id(201)+"'")).trim());
 await race("select pg_advisory_xact_lock(hashtextextended('"+id(11)+"',18))", "reset role; update public.movement_series set treasury_revision=1 where id='"+id(201)+"'",false);
 assert.ok(Number((await sql("select treasury_revision from public.movement_series where id='"+id(201)+"'")).trim())>beforeRevision,'source edit must advance version after runtime lock');
 const receipt="set local role domus_treasury_executor; insert into private.treasury_operation_receipts(actor_id,household_id,operation_id,request,response) values('"+id(1)+"','"+id(11)+"','"+id(901)+"','{}','{}')";
 await race(receipt,receipt,true);
 await assert.rejects(()=>sql('begin;'+asActor+'select * from private.treasury_operation_receipts;commit;'),/permission denied/i);
 assert.ok(pids.size>=2);
 console.log('PASS: 8 PostgreSQL lock races plus rollback, identity, timestamps, cross-household reads and unchanged identical lines; independent backends.');
} finally {
 if(started)execFileSync('pg_ctl',['-D',dir,'-m','fast','-w','stop'],{env,windowsHide:true,stdio:'pipe'});
 const resolved=path.resolve(dir),base=path.resolve(os.tmpdir())+path.sep;
 if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('domus16-pg-'))throw Error('Unsafe cleanup target');
 await rm(resolved,{recursive:true,force:true});
}
