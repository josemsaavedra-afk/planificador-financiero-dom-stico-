import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import {createTransactionalTreasuryBackend} from '../src/treasury/transactional-backend.js';
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const csv='Fecha;Concepto;Importe\n2026-09-19;Compra;-10\n2026-09-19;Compra;-10';
const db=new PGlite();for(const file of ['database/tests/treasury_fixture.sql','database/proposals/alpha16_prerc_up.sql','database/proposals/alpha18_runtime_up.sql'])await db.exec(await readFile(file,'utf8'));
let loseResponse=false,holdResponse=false,releaseResponse,actor=id(1),calls=0;
const backend=createTransactionalTreasuryBackend({transaction:async fn=>{
 const result=await db.transaction(async tx=>{await tx.exec('set local role domus_treasury_executor');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);return fn(tx);});
 if(holdResponse){holdResponse=false;await new Promise(resolve=>releaseResponse=resolve);}
 if(loseResponse){loseResponse=false;throw new TypeError('fixture response lost');}return result;
}});
const root=path.resolve('dist'),mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=createServer(async(req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+decodeURIComponent(pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}try{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const profile=await mkdtemp(path.join(os.tmpdir(),'domus18-browser-'));
let browser,page;
async function poll(check,label){for(let n=0;n<200;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timeout: '+label);}
async function open(){
 browser=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},serviceWorkers:'block',...(process.platform==='win32'?{channel:'msedge'}:{})});
 await browser.routeWebSocket('**',socket=>socket.close());await browser.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await browser.addInitScript(()=>window.DOMUS_CONFIG={treasuryPersistence:true});
 await browser.exposeFunction('fixtureExecute',async(envelope,context)=>{calls++;try{return {value:await backend.execute(envelope,context)};}catch(error){return {error:{code:error.code,details:error.details}};}});
 page=await browser.newPage();await page.goto(origin+'/domus-3/index.html');await page.waitForFunction(()=>window.DOMUSTreasury3);
 await page.evaluate(async({userId,householdId,accountId,seriesId})=>{
  const {TreasuryError}=await import('./src/treasury/runtime-contract.js');
  window.fixtureBackend={execute:async(envelope,context)=>{const response=await fixtureExecute(envelope,context);if(response.error)throw new TreasuryError(response.error.code,response.error.details);return response.value;}};
  window.fixtureRuntime=DOMUSTreasury3.configurePersistence(window.fixtureBackend);
  window.fixtureSnapshot={userId,householdId,asOf:'2026-09-20',accounts:[{id:accountId,household_id:householdId,name:'Banco ficticio'}],rows:[{id:seriesId+'|2026-09-19',series_id:seriesId,occurrence_date:'2026-09-19',expected_treasury_date:'2026-09-19',actual_date:'2026-09-19',concept:'Compra',type:'expense',amount:10,status:'done',account_id:accountId,household_id:householdId}]};
  DOMUSTreasury3.render(window.fixtureSnapshot);document.getElementById('authScreen').classList.add('hidden');document.getElementById('appScreen').classList.remove('hidden');document.querySelector('#treasury3Root').closest('section')?.classList.remove('hidden');document.querySelector('#treasury3Root').parentElement.classList.remove('hidden');
 },{userId:id(1),householdId:id(11),accountId:id(101),seriesId:id(201)});
 // Render the actual module without calling any production authentication endpoint.
 await page.evaluate(()=>{let node=document.getElementById('treasury3Root');while(node){node.classList.remove('hidden');node=node.parentElement;}});
}
const rows=()=>page.evaluate(()=>fixtureRuntime.list());
const count=async table=>(await db.query('select count(*)::int n from '+table)).rows[0].n;
async function sync(){await page.locator('[data-sync-treasury]').click();await poll(async()=>!(await rows()).some(row=>row.state==='syncing'||row.state==='pending'),'outbox settled');}
try{
 await open();
 await page.locator('[data-opening-amount]').fill('100');await page.locator('[data-opening-date]').fill('2026-09-18');
 await page.locator('[data-enqueue-checkpoint]').evaluate(button=>{button.click();button.click();});await poll(async()=>(await rows()).length===1,'durable checkpoint');assert.equal(calls,0);assert.equal((await rows())[0].state,'pending');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await browser.close();await open();assert.equal((await rows())[0].state,'pending'); // actual browser restart, same temporary profile
 loseResponse=true;await sync();assert.equal((await rows())[0].state,'retryable_error');assert.equal(await count('public.account_balance_checkpoints'),1);
 await browser.close();await open();await page.getByRole('button',{name:'Reintentar operación conservada'}).click();await poll(async()=>(await rows())[0].state==='confirmed','lost response replay');assert.equal(await count('public.account_balance_checkpoints'),1);
 await page.locator('#treasuryCsvAccount').selectOption(id(101));await page.locator('#treasuryCsv').setInputFiles({name:'ficticio.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
 await page.locator('[data-enqueue-import]').click();await poll(async()=>(await rows()).some(row=>row.type==='import'),'import prepared');await sync();assert.equal(await count('public.bank_statement_lines'),2);
 await page.locator('[data-load-treasury]').click();await page.getByText('Historial actualizado.',{exact:false}).waitFor();
 await page.locator('[data-review-confirm]').first().click();await page.locator('[data-enqueue-confirmations]').click();await poll(async()=>(await rows()).some(row=>row.type==='confirm'),'confirmation prepared');await sync();assert.equal(await count('public.treasury_reconciliations'),1);
 await page.locator('[data-load-treasury]').click();await page.locator('[data-revoke-reason]').fill('Corrección ficticia');await page.locator('[data-revoke-id]').click();await poll(async()=>(await rows()).some(row=>row.type==='revoke'),'revocation prepared');await sync();assert.equal((await db.query('select status from public.treasury_reconciliations')).rows[0].status,'revoked');
 await page.screenshot({path:'artifacts/alpha18-runtime-390.png',fullPage:true});
 // Crash after database commit, BEFORE a response reaches IndexedDB.
 holdResponse=true;await page.evaluate(async accountId=>{await fixtureRuntime.createCheckpoint({accountId,amount:'80',date:'2026-09-19'});void fixtureRuntime.syncPendingOperations();},id(101));
 await poll(()=>Boolean(releaseResponse),'backend committed response held');assert.equal(await count('public.account_balance_checkpoints'),2);assert.ok((await rows()).some(row=>row.state==='syncing'));
 await browser.close();releaseResponse();releaseResponse=null;await open();
 // Simulated time advance on reopen, without altering persisted lease or identity.
 await page.evaluate(async()=>{const {createIndexedDbOutbox}=await import('./src/treasury/outbox-store.js');const {createPersistenceRuntime}=await import('./src/treasury/persistence-runtime.js');const recovery=createPersistenceRuntime({enabled:true,backend:fixtureBackend,store:createIndexedDbOutbox(),getContext:()=>({userId:fixtureSnapshot.userId,householdId:fixtureSnapshot.householdId}),now:()=>Date.now()+120000});await recovery.syncPendingOperations();});
 assert.equal(await count('public.account_balance_checkpoints'),2);assert.ok((await rows()).every(row=>row.state==='confirmed'));
 // Stale source preserves proposal and evidence across another full browser restart.
 await page.evaluate(async({seriesId,accountId})=>{const state=await fixtureRuntime.loadTreasuryState(),source=state.sources.find(row=>row.series_id===seriesId),line=state.lines[1];await fixtureRuntime.confirmReconciliation({id:crypto.randomUUID(),accountId,statementLineId:line.id,seriesId,occurrenceDate:'2026-09-19'},{baseRevision:{series:source.series,occurrence:source.occurrence,lineHash:line.content_sha256}});},{seriesId:id(201),accountId:id(101)});
 await db.query('update public.movement_series set treasury_revision=1 where id=$1',[id(201)]);await sync();assert.equal((await rows()).at(-1).lastError.code,'STALE_VERSION');
 await browser.close();await open();assert.ok((await rows()).some(row=>row.state==='conflict'&&row.lastError.details));await page.getByText('Requiere revisión',{exact:true}).waitFor();await page.getByRole('button',{name:'Conservar historial remoto y archivar propuesta'}).click();await poll(async()=>(await rows()).some(row=>row.resolution==='remote_accepted'),'conflict review retained');assert.equal(await count('public.treasury_reconciliations'),1);
 // A real IndexedDB outbox can contain another legitimate household, without mixing it.
 await page.evaluate(async({userId,householdId,accountId})=>{DOMUSTreasury3.render({...fixtureSnapshot,userId,householdId,accounts:[],rows:[]});await fixtureRuntime.createCheckpoint({accountId,amount:'20',date:'2026-09-19'});}, {userId:id(3),householdId:id(12),accountId:id(102)});
 assert.equal((await rows()).length,1);actor=id(3);await page.evaluate(()=>fixtureRuntime.syncPendingOperations());assert.equal((await rows())[0].state,'confirmed');
 await page.evaluate(()=>DOMUSTreasury3.reset());await assert.rejects(()=>rows());await page.evaluate(()=>DOMUSTreasury3.render(fixtureSnapshot));assert.ok((await rows()).length>1);assert.ok((await rows()).every(row=>row.userId===id(1)&&row.householdId===id(11)));
 console.log('PASS: 8 Alpha18 browser scenarios: durable-before-send/restart, lost response replay, UI import/confirm/revoke + SQL, 390px, crash/orphan lease, persistent conflict/review, household isolation, logout ownership. All backend data fictitious.');
} catch(error) {
 if(page&&!page.isClosed()){console.log('Runtime fixture UI:',await page.locator('#treasuryCsvResult').innerText());await page.screenshot({path:'artifacts/alpha18-runtime-failure.png',fullPage:true});}
 throw error;
} finally {
 releaseResponse?.();await browser?.close();await db.close();await new Promise(resolve=>server.close(resolve));
 const resolved=path.resolve(profile),base=path.resolve(os.tmpdir())+path.sep;
 if(!resolved.startsWith(base)||!path.basename(resolved).startsWith('domus18-browser-'))throw Error('Unsafe fixture cleanup');
 await rm(resolved,{recursive:true,force:true});
}
