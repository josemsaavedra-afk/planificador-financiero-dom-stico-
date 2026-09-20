// Opt-in harness: creates its OWN temporary cluster. Never accepts a database URL.
// Requires initdb, pg_ctl and psql on PATH. No production credentials or external host.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
for(const command of ['initdb','pg_ctl','psql'])execFileSync(command,['--version'],{stdio:'pipe'});
const dir=await mkdtemp(path.join(os.tmpdir(),'domus16-pg-'));
const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));
const port=socket.address().port;await new Promise(r=>socket.close(r));
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:String(port),PGUSER:'domus_fixture',PGDATABASE:'postgres',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=15000 -c lock_timeout=10000',PGPASSWORD:'',PGSERVICE:'',PGSERVICEFILE:path.join(dir,'no-service'),PGPASSFILE:path.join(dir,'no-password')};
function sql(text) {return new Promise((resolve,reject)=>{
 const child=spawn('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',text],{env,windowsHide:true});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
 child.on('close',code=>code===0?resolve(out):reject(new Error(err)));
});}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const asActor=`set local role authenticated;select set_config('request.jwt.claim.sub','${id(1)}',true);`;
let started=false;
try {
 execFileSync('initdb',['-D',dir,'--auth=trust','--username=domus_fixture','--no-locale','--encoding=UTF8'],{env,windowsHide:true,stdio:'pipe'});
 execFileSync('pg_ctl',['-D',dir,'-l',path.join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start'],{env,windowsHide:true,stdio:'pipe'});started=true;
 await sql(await readFile('database/tests/treasury_fixture.sql','utf8'));
 await sql(await readFile('database/proposals/alpha16_prerc_up.sql','utf8'));
 const pids=new Set();
 async function race(first,second,expectDuplicate) {
   // Hold the first transaction until the second backend visibly waits on a lock.
   const a=sql(`begin;${asActor}select 'PID:'||pg_backend_pid();${first};select pg_sleep(2);commit;`);
   a.catch(()=>{});
   let firstReady=false;
   for(let i=0;i<100;i++){if((await sql("select count(*) from pg_stat_activity where usename='domus_fixture' and wait_event='PgSleep'")).trim()==='1'){firstReady=true;break;}await new Promise(r=>setTimeout(r,10));}
   assert.ok(firstReady,'first connection must hold its transaction');
   const b=sql(`begin;${asActor}select 'PID:'||pg_backend_pid();${second};commit;`);b.catch(()=>{});
   let blocked=false;
   for(let i=0;i<100;i++){if(Number((await sql("select count(*) from pg_stat_activity where usename='domus_fixture' and wait_event_type='Lock'")).trim())>0){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}
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
 await race(confirmation(401),confirmation(402),true);
 const revoke="update public.treasury_reconciliations set status='revoked',revoked_by=auth.uid(),revocation_reason='fixture' where status='confirmed' returning 'REVOKED'";
 const revoked=await race(revoke,revoke,false);
 assert.equal(revoked.map(r=>(r.value.match(/^REVOKED$/gm)||[]).length).join(','),'1,0');
 await sql(`begin;${asActor}${confirmation(401)};commit;`);
 await assert.rejects(()=>sql(`update public.movement_series set account_id='${id(103)}' where id='${id(201)}'`),/foreign key/i);
 assert.equal((await sql('select count(*) from public.bank_statement_lines')).trim(),'2');
 assert.ok(pids.size>=2);
 console.log('PASS: 3 real PostgreSQL lock races (duplicate, confirmation, revocation), reconfirmation and parent integrity. Independent backends; fictitious temporary cluster.');
} finally {
 if(started)execFileSync('pg_ctl',['-D',dir,'-m','fast','-w','stop'],{env,windowsHide:true,stdio:'pipe'});
 const resolved=path.resolve(dir),base=path.resolve(os.tmpdir())+path.sep;
 if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('domus16-pg-'))throw Error('Unsafe cleanup target');
 await rm(resolved,{recursive:true,force:true});
}
