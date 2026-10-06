import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const baseline='a7c280a2353553bf297db9ba5070117a3fccc80a';
const oldFiles=['config.js','index.html','sw.js','manifest.webmanifest','version.json','icon-180.png','icon-192.png','icon-512.png',...execFileSync('git',['ls-tree','-r','--name-only',baseline,'src/treasury'],{encoding:'utf8'}).trim().split(/\r?\n/)];
const oldAssets=new Map(oldFiles.map(file=>['/domus-3/'+file,execFileSync('git',['show',baseline+':'+file],{maxBuffer:8*1024*1024})]));
oldAssets.set('/domus-3/asset-manifest.js',Buffer.from('self.DOMUS3_BUILD=30018;self.DOMUS3_ASSETS='+JSON.stringify([...oldFiles.filter(f=>f!=='sw.js'),'vendor/supabase.js'])+';'));

const root = path.resolve('dist');
let workerBuild=null,failPrecache=false;
const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png' };
const server = createServer(async (req,res) => {
  const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname==='/legacy.html'){res.setHeader('Content-Type','text/html');res.end('<h1>Legacy fixture</h1>');return;}
  const file = path.resolve(root,'.'+pathname);
  if (!file.startsWith(root+path.sep)) { res.writeHead(403);res.end();return; }
  try { let body=workerBuild===30018&&oldAssets.has(pathname)?oldAssets.get(pathname):await readFile(file);if(pathname.endsWith('/asset-manifest.js')&&workerBuild!==null)body=body.toString().replace(/DOMUS3_BUILD=\d+/, 'DOMUS3_BUILD='+workerBuild);if(pathname.endsWith('/sw.js')&&workerBuild!==null)body=body.toString()+'\n// fixture build '+workerBuild;if(failPrecache&&pathname.endsWith('/vendor/supabase.js')){res.writeHead(503);res.end();return;}res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(body); }
  catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'msedge'}:{})});
await mkdir('artifacts',{recursive:true});
const uid='00000000-0000-4000-8000-000000000001',hid='00000000-0000-4000-8000-000000000011',aid='00000000-0000-4000-8000-000000000101';
const actor={id:uid,email:'test@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
const mutations=[];
const jwt=[{alg:'HS256',typ:'JWT'},{sub:uid,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fake';
const historicalStates=Array.from({length:1201},(_,i)=>i===0?{series_id:'00000000-0000-4000-8000-000000000201',occurrence_date:'2026-09-18',actual_date:'2026-09-18',status:'done'}:{series_id:'fixture-series-'+i,occurrence_date:'2026-01-01',status:'done'});
let lastPage;
async function poll(check,label){for(let i=0;i<200;i++){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+label);}
async function isolate(context, options={}) {
  if(!options.noConfig)await context.addInitScript(()=>{window.DOMUS_CONFIG={supabaseUrl:'https://domus-fixture.supabase.co',supabasePublishableKey:'sb_publishable_fixture',treasuryPersistence:false};});
  await context.routeWebSocket('**',socket=>socket.close());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin)return route.continue();
    if(url.hostname==='domus-fixture.invalid') {const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return route.abort();try{return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}}
    if(url.hostname==='cdn.jsdelivr.net')return route.fulfill({contentType:'text/javascript',body:''});
    if(!url.hostname.endsWith('.supabase.co'))return route.abort();
    const json=body=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    if(url.pathname==='/auth/v1/signup'&&options.signup){mutations.push({kind:'signup',redirect:url.searchParams.get('redirect_to')});return json(actor);}
    if(url.pathname==='/auth/v1/recover'&&request.method()==='POST'){mutations.push({kind:'recover',body:request.postDataJSON(),redirect:url.searchParams.get('redirect_to')});return json({});}
    if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password'){if(request.postDataJSON().password==='incorrecta')return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'invalid_credentials',msg:'Invalid login credentials'})});mutations.push({kind:'login'});return json({access_token:jwt,refresh_token:'fake-refresh',expires_in:3600,token_type:'bearer',user:actor});}
    if(url.pathname==='/auth/v1/logout'){assert.equal(url.searchParams.get('scope'),'local');mutations.push({kind:'logout'});return json({});}
    if(url.pathname==='/auth/v1/user'){if(request.headers().authorization?.endsWith('.invalid'))return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({code:'bad_jwt',msg:'Invalid token'})});if(request.method()==='PUT')mutations.push({kind:'password',body:request.postDataJSON()});return json(actor);}
    if(request.method()!=='GET')throw new Error('Unexpected mutation: '+request.method()+' '+url.pathname);
    const table=url.pathname.split('/').pop();
    const data={household_members:[{user_id:uid,household_id:hid}],households:{id:hid,name:'Hogar ficticio',invite_code:'TEST'},accounts:[{id:aid,household_id:hid,name:'Banco ficticio'}],movement_series:[{id:'00000000-0000-4000-8000-000000000201',household_id:hid,account_id:aid,start_date:'2026-09-18',type:'expense',amount:10,concept:'Compra',recurrence:'none'}],movement_occurrence_states:[{series_id:'00000000-0000-4000-8000-000000000201',occurrence_date:'2026-09-18',actual_date:'2026-09-18',status:'done'}],treasury_rules:null};
    if(table==='household_members'&&options.noHousehold)return json([]);
    if(table==='household_members'&&options.twoHouseholds)return json([{user_id:uid,household_id:hid},{user_id:uid,household_id:'00000000-0000-4000-8000-000000000012'}]);
    if(table==='movement_occurrence_states') {const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);return json(historicalStates.slice(offset,offset+limit));}
    return json(data[table]??[]);
  });
}

try {
  const context=await browser.newContext({viewport:{width:390,height:844},acceptDownloads:true});
  await isolate(context);
  const page=await context.newPage(),errors=[];lastPage=page;page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('Browser error:',m.text().replace(/https?:\/\/\S+/g,'[url]'));});
  await page.goto(origin+'/domus-3/index.html');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'login at 390px');
  for(const [width,height] of [[360,800],[412,915],[844,390],[768,1024],[1440,900]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Auth '+width);}await page.setViewportSize({width:390,height:844});
  await page.locator('#authEmail').fill(actor.email);
  await page.locator('#forgotPasswordBtn').click();
  await page.getByText(/Si el correo pertenece a una cuenta/).waitFor();
  assert.equal(mutations[0].redirect,origin+'/domus-3/index.html');
  await page.goto(origin+'/legacy.html');
  await page.goto(origin+'/domus-3/index.html#access_token='+jwt+'&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=recovery');
  await page.locator('#passwordRecoveryForm:not(.hidden)').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'recovery at 390px');
  for(const [width,height] of [[360,800],[412,915],[844,390],[768,1024],[1440,900]]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Recovery '+width);}await page.setViewportSize({width:390,height:844});
  assert.equal(new URL(page.url()).hash,'');
  await page.locator('#recoveryPassword').fill('Ficticia-segura-123');
  await page.locator('#recoveryPasswordConfirm').fill('no-coincide');
  await page.locator('#recoveryPasswordSubmit').click();
  await page.getByText('Las dos contraseñas no coinciden.').waitFor();
  assert.equal(mutations.filter(m=>m.kind==='password').length,0);
  await page.locator('#recoveryPasswordConfirm').fill('Ficticia-segura-123');
  await page.locator('#recoveryPasswordSubmit').click();
  await page.locator('#appScreen:not(.hidden)').waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('#treasury3Root [data-balance-account]').length===1);
  assert.equal(mutations.filter(m=>m.kind==='password').length,1);
  assert.deepEqual(await page.evaluate(()=>({userId:user.id,householdId:household.id})),{userId:uid,householdId:hid});
  assert.equal(await page.evaluate(()=>states.length),1201,'historical states are paginated beyond API default cap');
  await page.locator('#bottomNav [data-view="treasury"]').click();
  await page.locator('[data-opening-amount]').fill('100');
  await page.locator('[data-opening-date]').fill('2026-09-17');
  await page.locator('[data-save-opening]').click();
  await page.locator('[data-closing-amount]').fill('90');
  await page.locator('[data-closing-date]').fill('2026-09-19');
  await page.locator('[data-check-balance]').click();
  assert.match(await page.locator('[data-balance-result]').innerText(),/Cuadrado/);
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-download-checkpoint]').click();
  assert.match((await downloadPromise).suggestedFilename(),/^domus-saldo-/);
  await page.locator('#treasuryCsvAccount').selectOption(aid);
  await page.locator('#treasuryCsv').setInputFiles({name:'ficticio.csv',mimeType:'text/csv',buffer:Buffer.from('Fecha;Concepto;Importe\n2026-09-18;Compra;-10')});
  await page.locator('[data-review-confirm]').click();
  await page.evaluate(()=>renderTreasury3());
  assert.match(await page.locator('#treasuryCsvResult').innerText(),/1 confirmadas localmente/);
  assert.equal(await page.locator('[data-persistence-mode]').getAttribute('data-persistence-mode'),'local');
  const attack='<img src=x onerror="window.__xss=1">';
  await page.evaluate(value=>{series[0].concept=value;renderAll();},attack);
  await page.locator('#treasuryCsvAccount').selectOption(aid);
  await page.locator('#treasuryCsv').setInputFiles({name:'xss.csv',mimeType:'text/csv',buffer:Buffer.from('Fecha;Concepto;Importe\n2026-09-18;"'+attack.replaceAll('"','""')+'";-10')});
  await page.getByText(attack,{exact:true}).first().waitFor();assert.equal(await page.locator('#treasury3Root img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
  await page.evaluate(()=>{series[0].concept='Compra';renderAll();});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  assert.equal(overflow,false,'390px page must not overflow horizontally');
  await page.screenshot({path:'artifacts/treasury-390.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:'artifacts/treasury-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  // Real IndexedDB, with fictitious operations only; never flush them to HTTP.
  const queueResult=await page.evaluate(async()=>{
    const originalUser=user,originalHousehold=household;
    await queueOffline({kind:'insert',table:'fixture_only',row:{id:'local'}});
    const own=(await queuedOps()).length;
    household={id:'another-household'};const otherHousehold=(await queuedOps()).length;
    household=originalHousehold;user={id:'another-user'};const otherUser=(await queuedOps()).length;
    user=originalUser;const recovered=await queuedOps();await removeQueued(recovered[0].qid,user.id);
    return {own,otherHousehold,otherUser,recovered:recovered.length,remaining:(await queuedOps()).length};
  });
  assert.deepEqual(queueResult,{own:1,otherHousehold:0,otherUser:0,recovered:1,remaining:0});
  for(const [width,height] of [[360,800],[412,915],[844,390],[768,1024],[1440,900]]) {
    await page.setViewportSize({width,height});
    for(const view of ['dashboard','treasury']){await page.evaluate(v=>showView(v),view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,view+' viewport '+width);}
    await page.evaluate(()=>openForm());await page.locator('#movementModal.show').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'modal '+width);
    assert.equal(await page.locator('#fConcept').evaluate(el=>el.labels.length),1);
    assert.equal(await page.evaluate(()=>document.activeElement.id),'fConcept');
    await page.locator('#movementModal button.x').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.getElementById('movementModal').contains(document.activeElement)),true);
    await page.locator('#fConcept').fill('Solo prueba visual');await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.getElementById('movementModal').classList.contains('show'));
    await page.screenshot({path:'artifacts/viewport-'+width+'.png',fullPage:true});
  }
  await page.reload();await page.locator('#appScreen:not(.hidden)').waitFor();
  assert.deepEqual(await page.evaluate(()=>({u:user.id,h:household.id})),{u:uid,h:hid});
  await page.evaluate(()=>logout());await page.locator('#authForm:not(.hidden)').waitFor();
  await page.locator('#authEmail').fill(actor.email);await page.locator('#authPassword').fill('incorrecta');await page.locator('#authSubmit').click();await page.getByText('Correo o contraseña incorrectos.').waitFor();await page.locator('#authPassword').fill('Ficticia-segura-123');await page.locator('#authSubmit').click();
  await page.locator('#appScreen:not(.hidden)').waitFor();
  assert.equal(mutations.filter(m=>m.kind==='login').length,1);
  await context.close();

  workerBuild=30018;
  const offline=await browser.newContext();await isolate(offline);const shell=await offline.newPage();
  await shell.goto(origin+'/legacy.html');
  await shell.evaluate(async()=>{await caches.open('domus-258');await caches.open('planificador-258');});
  await shell.goto(origin+'/domus-3/index.html');
  await shell.evaluate(()=>navigator.serviceWorker.ready);
  await shell.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const keys=await shell.evaluate(()=>caches.keys());
  assert.ok(keys.includes('domus-258')&&keys.includes('planificador-258'));
  assert.ok(keys.some(k=>k.startsWith('domus3:/domus-3/:')));
  assert.match(await shell.evaluate(()=>navigator.serviceWorker.controller.scriptURL),/\/domus-3\/sw.js/);
  await offline.setOffline(true);
  await shell.reload();await shell.locator('#authForm:not(.hidden)').waitFor();
  assert.equal(await shell.evaluate(()=>typeof supabase.createClient),'function');
  assert.equal(await shell.evaluate(()=>typeof window.DOMUSTreasury3.render),'function');assert.equal(await shell.evaluate(()=>APP_BUILD),'30018');
  await offline.setOffline(false);
  await shell.evaluate(async()=>{localStorage.setItem('domus17-retained','ficticio');await kvPut('update-proof',{value:'ficticio'});});
  workerBuild=30018;
  await shell.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;await reg.update();});
  await poll(()=>shell.evaluate(async()=> (await caches.keys()).includes('domus3:/domus-3/:30018')),'PWA lifecycle');
  await poll(()=>shell.evaluate(async()=> (await caches.keys()).filter(k=>k.startsWith('domus3:/domus-3/:')).length===1),'PWA lifecycle');
  await poll(()=>shell.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;return reg.active?.state==='activated'&&!reg.installing&&!reg.waiting;}),'PWA lifecycle');
  workerBuild=30019;
  await shell.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;await reg.update();});
  await poll(()=>shell.evaluate(async()=>{const keys=await caches.keys();return keys.includes('domus3:/domus-3/:30019')&&!keys.includes('domus3:/domus-3/:30018');}),'PWA lifecycle');
  assert.ok((await shell.evaluate(()=>caches.keys())).includes('domus-258'));
  await poll(()=>shell.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;return reg.active?.state==='activated'&&!reg.installing&&!reg.waiting;}),'PWA lifecycle');
  assert.equal(await shell.evaluate(()=>localStorage.getItem('domus17-retained')),'ficticio');assert.equal(await shell.evaluate(async()=>(await kvGet('update-proof')).value),'ficticio');
  failPrecache=true;workerBuild=39999;
  const state=await shell.evaluate(async()=>{const reg=await navigator.serviceWorker.ready;const failed=new Promise(resolve=>reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker.addEventListener('statechange',()=>{if(worker.state==='redundant')resolve(worker.state);});},{once:true}));await reg.update();return failed;});
  assert.equal(state,'redundant');
  assert.ok((await shell.evaluate(()=>caches.keys())).includes('domus3:/domus-3/:30019'));
  failPrecache=false;workerBuild=null;await offline.setOffline(true);
  const manifest=JSON.parse(await readFile('manifest.webmanifest','utf8'));
  await shell.goto(new URL(manifest.start_url,origin+'/domus-3/').href);await shell.locator('#authForm:not(.hidden)').waitFor();
  await offline.setOffline(false);await shell.reload();await shell.locator('#authForm:not(.hidden)').waitFor();assert.equal(await shell.evaluate(()=>APP_BUILD),'30019');assert.equal(await shell.evaluate(async()=>(await kvGet('update-proof')).value),'ficticio');
  await offline.close();
  const expired=await browser.newContext({viewport:{width:390,height:844}});await isolate(expired);
  const invalid=await expired.newPage();
  await invalid.goto(origin+'/domus-3/index.html#error=access_denied&error_code=otp_expired&error_description=Link%20expired');
  await invalid.locator('#authForm:not(.hidden)').waitFor();
  assert.equal(await invalid.locator('#passwordRecoveryForm').isVisible(),false);
  assert.equal(mutations.filter(m=>m.kind==='password').length,1,'invalid link must not update a user');
  await invalid.goto(origin+'/legacy.html');
  await invalid.goto(origin+'/domus-3/index.html#access_token='+jwt+'&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=recovery');
  await invalid.locator('#passwordRecoveryForm:not(.hidden)').waitFor();
  const duplicate=await expired.newPage();await duplicate.goto(invalid.url()+'#access_token='+jwt+'&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=recovery');await duplicate.locator('#passwordRecoveryForm:not(.hidden)').waitFor();assert.equal(mutations.filter(m=>m.kind==='password').length,1);await duplicate.close();
  await invalid.locator('#recoveryCancel').click();
  await invalid.locator('#authForm:not(.hidden)').waitFor();assert.equal(await invalid.evaluate(()=>user),null);
  await invalid.goto(origin+'/legacy.html');await invalid.goto(origin+'/domus-3/index.html#access_token='+jwt.replace('.fake','.invalid')+'&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=recovery');
  await invalid.locator('#authForm:not(.hidden)').waitFor();assert.equal(await invalid.locator('#passwordRecoveryForm').isVisible(),false);assert.equal(mutations.filter(m=>m.kind==='password').length,1);
  await expired.close();
  const publicContext=await browser.newContext({serviceWorkers:'block'});await isolate(publicContext);const publicPage=await publicContext.newPage();
  await publicPage.goto('https://domus-fixture.invalid/domus-3/index.html');await publicPage.locator('#authEmail').fill(actor.email);await publicPage.locator('#forgotPasswordBtn').click();await publicPage.getByText(/Si el correo pertenece a una cuenta/).waitFor();
  assert.equal(mutations.filter(m=>m.kind==='recover').at(-1).redirect,'https://domus-fixture.invalid/domus-3/index.html');await publicContext.close();
  const signupContext=await browser.newContext({serviceWorkers:'block'});const membershipOptions={signup:true,noHousehold:true};await isolate(signupContext,membershipOptions);const signup=await signupContext.newPage();
  await signup.goto(origin+'/domus-3/index.html');await signup.locator('#toggleAuthMode').click();await signup.locator('#authEmail').fill(actor.email);await signup.locator('#authPassword').fill('Ficticia-segura-123');await signup.locator('#authSubmit').click();await signup.getByText(/Cuenta creada. Revisa tu correo/).waitFor();
  assert.equal(mutations.filter(m=>m.kind==='signup').length,1);assert.equal(mutations.filter(m=>m.kind==='signup')[0].redirect,origin+'/domus-3/index.html');
  await signup.goto(origin+'/legacy.html');await signup.goto(origin+'/domus-3/index.html#access_token='+jwt+'&refresh_token=fake-refresh&expires_in=3600&token_type=bearer&type=signup');await signup.locator('#onboardingScreen:not(.hidden)').waitFor();
  membershipOptions.noHousehold=false;membershipOptions.twoHouseholds=true;await signup.reload();await signup.locator('#appScreen:not(.hidden)').waitFor();assert.equal(await signup.evaluate(()=>household.id),hid);
  membershipOptions.noHousehold=true;await signup.evaluate(()=>routeBySession());await signup.locator('#onboardingScreen:not(.hidden)').waitFor();assert.equal(await signup.locator('#treasury3Root').innerText(),'');assert.equal(await signup.evaluate(()=>household),null);assert.equal(await signup.evaluate(()=>kvGet('snapshot:'+user.id)),null);await signupContext.close();
  const unconfigured=await browser.newContext({serviceWorkers:'block'});await isolate(unconfigured,{noConfig:true});const blank=await unconfigured.newPage();await blank.goto(origin+'/domus-3/index.html');await blank.getByText(/Configura el backend aislado/).waitFor();assert.equal(await blank.locator('#authSubmit').isDisabled(),true);assert.equal(await blank.evaluate(()=>sb),null);await unconfigured.close();
  console.log('PASS: 20 browser scenarios (12 Alpha16 + 2 viewports + XSS + duplicate recovery + signup/confirmation + membership variants + unconfigured backend + invalid token): recovery/mobile/checkpoints/history (1201 states), IndexedDB user/household isolation, PWA offline reload and legacy caches, expired recovery link. Real SDK, mocked HTTP only.');
} catch(error) { if(lastPage&&!lastPage.isClosed()){console.log('Auth state:',await lastPage.locator('#authMsg').innerText());await lastPage.screenshot({path:'artifacts/browser-failure.png',fullPage:true});}throw error; } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
