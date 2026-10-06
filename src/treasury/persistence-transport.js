import {TreasuryError,fail} from './runtime-contract.js';

// Opt-in same-origin HTTPS transport. Tokens are obtained at send time and never
// enter the durable envelope. No URL/client/key is inferred from Supabase config.
export function createTreasuryTransport({endpoint,origin=globalThis.location?.origin,getAccessToken,fetchImpl=globalThis.fetch}) {
  if(typeof endpoint!=='string'||!endpoint.trim())fail('INVALID_PAYLOAD');
  let url;
  try {url=new URL(endpoint,origin);}catch{fail('INVALID_PAYLOAD');}
  if(url.origin!==origin||url.protocol!=='https:'||url.username||url.password||url.search||url.hash||typeof getAccessToken!=='function'||typeof fetchImpl!=='function')fail('INVALID_PAYLOAD');
  return Object.freeze({async execute(row,context,signal){
    const token=await getAccessToken();if(typeof token!=='string'||!token)fail('UNAUTHORIZED');
    const operation=row.type==='read'?{type:'read'}:{id:row.id,idempotencyKey:row.idempotencyKey,type:row.type,payload:row.payload,baseRevision:row.baseRevision};
    const response=await fetchImpl(url.href,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({actorId:context.userId,householdId:context.householdId,operation})});
    if(response.status===401||response.status===403)fail('UNAUTHORIZED');
    if(response.status>=500||response.status===408||response.status===429)fail('BACKEND_UNAVAILABLE');
    let result;try{result=await response.json();}catch{fail('BACKEND_UNAVAILABLE');}
    if(result?.error)throw new TreasuryError(result.error.code,result.error.details);
    if(!response.ok||!result||!Object.hasOwn(result,'value'))fail('INTEGRITY_VIOLATION');
    return result.value;
  }});
}
