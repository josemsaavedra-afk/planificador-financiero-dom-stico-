import {createTreasuryRequestHandler} from '../src/treasury/transactional-backend.js';
import {TreasuryError,classifyError,fail,identity} from '../src/treasury/runtime-contract.js';

// Server-only. authClient must be configured by the host for its isolated project,
// with session persistence/refresh disabled. getUser verifies through Auth; no JWT
// payload, cookie, user_metadata or submitted actor is treated as authentication.
export function createAuthVerifier({authClient,timeoutMs=10000}) {
  if(typeof authClient?.auth?.getUser!=='function')fail('INVALID_PAYLOAD');
  return async request=>{
    const authorization=request.headers.get('authorization');
    if(!authorization||!/^Bearer [^\s,]+$/i.test(authorization)||authorization.length>16384)fail('UNAUTHORIZED');
    const token=authorization.slice(7);let timer;
    try{
      const result=await Promise.race([authClient.auth.getUser(token),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new TreasuryError('BACKEND_UNAVAILABLE')),timeoutMs);})]);
      if(result.error){if(result.error.status>=500||[0,408,429].includes(result.error.status))fail('BACKEND_UNAVAILABLE');fail('UNAUTHORIZED');}
      const user=result.data?.user;if(!user||user.is_anonymous===true)fail('UNAUTHORIZED');
      return Object.freeze({userId:identity(user.id)});
    }finally{clearTimeout(timer);}
  };
}

async function readJson(request,maxBytes,timeoutMs){
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))fail('INVALID_PAYLOAD');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))fail('INVALID_PAYLOAD');
  if(!request.body)fail('INVALID_PAYLOAD');
  const reader=request.body.getReader(),chunks=[];let size=0,cancelled=false;
  const cancel=()=>{cancelled=true;void reader.cancel().catch(()=>{});};
  const timer=setTimeout(cancel,timeoutMs);request.signal.addEventListener('abort',cancel,{once:true});
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();fail('INVALID_PAYLOAD');}chunks.push(value);}}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  if(cancelled)fail('BACKEND_UNAVAILABLE');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_PAYLOAD');}
}
const statuses={UNAUTHORIZED:401,HOUSEHOLD_MISMATCH:403,INVALID_PAYLOAD:400,DISABLED:503,BACKEND_UNAVAILABLE:503,STORAGE_UNAVAILABLE:503};
const response=(value,status=200,extra={})=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Authorization, Origin','X-Content-Type-Options':'nosniff',...extra}});

// Fetch-standard handler: no listener, environment reads, pool, credentials or
// deployments are created automatically. Every activation is explicit and OFF by default.
export function createTreasuryHttpHandler({enabled=false,origin,path='/domus-3/api/treasury',authenticate,transaction,maxBytes=8*1024*1024,bodyTimeoutMs=10000}){
  const expected=new URL(origin);
  if(expected.origin!==origin||expected.protocol!=='https:'||!path.startsWith('/')||path.includes('?')||path.includes('#')||typeof authenticate!=='function'||typeof transaction!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1)fail('INVALID_PAYLOAD');
  const handle=createTreasuryRequestHandler({authenticate:request=>request.session,transaction});
  return async request=>{
    try{
      if(enabled!==true)fail('DISABLED');
      const url=new URL(request.url);
      if(url.origin!==origin||url.pathname!==path||url.search)return response({error:{code:'INVALID_PAYLOAD'}},404);
      if(request.method!=='POST')return response({error:{code:'INVALID_PAYLOAD'}},405,{Allow:'POST'});
      const from=request.headers.get('origin');
      if((from&&from!==origin)||request.headers.get('sec-fetch-site')==='cross-site')fail('UNAUTHORIZED');
      if(request.signal.aborted)fail('BACKEND_UNAVAILABLE');
      const session=await authenticate(request);if(!session?.userId)fail('UNAUTHORIZED');
      const body=await readJson(request,maxBytes,bodyTimeoutMs);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['actorId','householdId','operation'].includes(key))||!body.operation||typeof body.operation!=='object'||Array.isArray(body.operation))fail('INVALID_PAYLOAD');
      const allowed=body.operation.type==='read'?['type']:['id','idempotencyKey','type','payload','baseRevision'];
      if(Object.keys(body.operation).some(key=>!allowed.includes(key)))fail('INVALID_PAYLOAD');
      if(request.signal.aborted)fail('BACKEND_UNAVAILABLE');
      return response({value:await handle({session,body},request.signal)});
    }catch(error){const safe=classifyError(error);return response({error:{code:safe.code,message:safe.message,details:safe.details}},statuses[safe.code]||409);}
  };
}
