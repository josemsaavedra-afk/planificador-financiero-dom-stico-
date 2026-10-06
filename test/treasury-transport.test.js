import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreasuryTransport} from '../src/treasury/persistence-transport.js';
import {createTreasuryRequestHandler} from '../src/treasury/transactional-backend.js';
const userId='00000000-0000-4000-8000-000000000001',householdId='00000000-0000-4000-8000-000000000011';
const config={origin:'https://isolated.example.invalid',endpoint:'/domus-3/api/treasury',getAccessToken:async()=>'fictitious-token'};
test('transport: HTTPS de mismo origen explícito, sin tokens en body ni redirecciones',async()=>{
 let sent;const backend=createTreasuryTransport({...config,fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,status:200,json:async()=>({value:{ok:true}})};}});
 assert.deepEqual(await backend.execute({type:'read'},{userId,householdId}),{ok:true});assert.equal(sent.url,config.origin+config.endpoint);assert.equal(sent.options.redirect,'error');assert.equal(sent.options.cache,'no-store');assert.equal(sent.options.headers.Authorization,'Bearer fictitious-token');assert.doesNotMatch(sent.options.body,/token/);assert.equal(JSON.parse(sent.options.body).actorId,userId);
});
test('transport: configuración insegura y ausencia de sesión fallan cerradas',async()=>{
 for(const endpoint of ['https://another.invalid/api','http://isolated.example.invalid/api','/api?token=x','/api#x','https://u:p@isolated.example.invalid/api'])assert.throws(()=>createTreasuryTransport({...config,endpoint}));
 const backend=createTreasuryTransport({...config,getAccessToken:async()=>null,fetchImpl:()=>{throw Error('No network');}});await assert.rejects(()=>backend.execute({type:'read'},{userId,householdId}),e=>e.code==='UNAUTHORIZED');
});
test('transport: timeout/5xx reintentables y conflicto sin mensaje SQL crudo',async()=>{
 for(const [status,code] of [[503,'BACKEND_UNAVAILABLE'],[408,'BACKEND_UNAVAILABLE'],[401,'UNAUTHORIZED']]){const backend=createTreasuryTransport({...config,fetchImpl:async()=>({status})});await assert.rejects(()=>backend.execute({type:'read'},{userId,householdId}),e=>e.code===code);}
 const backend=createTreasuryTransport({...config,fetchImpl:async()=>({status:409,ok:false,json:async()=>({error:{code:'STALE_VERSION',message:'raw SQL',details:{revision:6}}})})});await assert.rejects(()=>backend.execute({type:'read'},{userId,householdId}),e=>e.code==='STALE_VERSION'&&!e.message.includes('SQL'));
});
test('handler: cambio de sesión no atribuye operación pendiente a otro actor autenticado',async()=>{
 const handler=createTreasuryRequestHandler({authenticate:async()=>({userId:'00000000-0000-4000-8000-000000000003'}),transaction:()=>{throw Error('No transaction');}});
 await assert.rejects(()=>handler({body:{actorId:userId,householdId,operation:{type:'read'}}}),e=>e.code==='UNAUTHORIZED');
});
