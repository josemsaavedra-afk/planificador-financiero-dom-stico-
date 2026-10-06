import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createTreasuryPersistence } from '../src/treasury/persistence.js';
const ctx={window:{},URL};runInNewContext(readFileSync(new URL('../src/treasury/runtime-config.js',import.meta.url),'utf8'),ctx);
const {readConfig,authRedirect}=ctx.window.DOMUSRuntime;
test('configuración vacía, claves privadas o URL manipulada fallan cerradas',()=>{
 for(const raw of [{},{supabaseUrl:'http://unsafe.invalid',supabasePublishableKey:'sb_publishable_x'},{supabaseUrl:'https://user:pass@fixture.invalid',supabasePublishableKey:'sb_publishable_x'},{supabaseUrl:'https://fixture.invalid',supabasePublishableKey:'sb_secret_never'}, {supabaseUrl:'https://fixture.invalid?redirect=elsewhere',supabasePublishableKey:'sb_publishable_x'}])assert.equal(readConfig(raw).ready,false);
 assert.equal(readConfig({supabaseUrl:'https://fixture.invalid',supabasePublishableKey:'sb_publishable_x'}).ready,true);
 assert.equal(readConfig({treasuryPersistence:'true'}).treasuryPersistence,false);
});
test('redirect Auth conserva origen/ruta y descarta destinos y tokens manipulados',()=>{
 assert.equal(authRedirect('https://staging.example.invalid/domus-3/index.html?next=https://evil.invalid#access_token=private'),'https://staging.example.invalid/domus-3/index.html');
 assert.throws(()=>authRedirect('javascript:alert(1)'),/Origen/);assert.throws(()=>authRedirect('https://u:p@fixture.invalid/'),/Origen/);
});
test('sin flag o sin adaptador no hay escritura ni autodetección de Supabase',async()=>{
 let calls=0;for(const config of [{},{enabled:'true'},{enabled:true,backend:null}]){const port=createTreasuryPersistence({backend:{execute:()=>calls++},...config});await assert.rejects(()=>port.execute('confirm',{}),/desactivada/);}
 assert.equal(calls,0);
});
test('kill switch y cambio de contexto rechazan respuestas pendientes',async()=>{
 for(const change of ['disable','household']){let finish,context={userId:'a',householdId:'h'};const port=createTreasuryPersistence({enabled:true,getContext:()=>context,backend:{execute:()=>new Promise(r=>finish=r)}});const pending=port.execute('confirm',{});if(change==='disable')port.setEnabled(false);else context={userId:'a',householdId:'other'};finish({ok:true});await assert.rejects(pending,/obsoleta/);}
});
test('timeout no finge éxito y aborta el transporte',async()=>{
 let signal;const port=createTreasuryPersistence({enabled:true,timeoutMs:5,getContext:()=>({userId:'a',householdId:'h'}),backend:{execute:(_op,_input,_ctx,s)=>{signal=s;return new Promise(()=>{});}}});
 await assert.rejects(()=>port.execute('confirm',{}),/Resultado desconocido/);assert.equal(signal.aborted,true);
});
