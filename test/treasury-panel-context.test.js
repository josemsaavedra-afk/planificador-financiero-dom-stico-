import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistencePanel} from '../src/treasury/persistence-panel.js';

test('panel: cambiar usuario mientras calcula identidad no atribuye el saldo al nuevo usuario',async t=>{
 let snapshot={userId:'first',householdId:'same-household'},release,entered,button,enqueued=0;
 const hashing=new Promise(resolve=>entered=resolve);
 t.mock.method(globalThis.crypto.subtle,'digest',()=>{entered();return new Promise(resolve=>release=resolve);});
 const previous=globalThis.document;
 globalThis.document={createElement:()=>({setAttribute(){}})};
 try{
  const output={},box={appendChild:node=>button=node,querySelector:selector=>selector==='[data-balance-result]'?output:{value:selector==='[data-opening-date]'?'2026-09-19':'100'}};
  const panel=createPersistencePanel({runtime:{list:async()=>[],enqueue:async()=>enqueued++},getSnapshot:()=>snapshot,esc:value=>value});
  panel.bindCheckpoint(box,{id:'00000000-0000-4000-8000-000000000101'},'2026-09-20');const pending=button.onclick();await hashing;snapshot={userId:'second',householdId:'same-household'};release(new Uint8Array(32));await pending;
  assert.equal(enqueued,0);assert.match(output.textContent,/sesión ha cambiado/);
  await button.onclick();assert.equal(enqueued,0,'detached handler also rejects the new context');
 }finally{globalThis.document=previous;}
});
