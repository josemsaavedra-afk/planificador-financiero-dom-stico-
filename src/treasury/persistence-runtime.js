import { TreasuryError, fail, identity, canonical, validateOperation, classifyError } from './runtime-contract.js';

// The backend is an explicit authenticated API, never a discovered Supabase client.
export function createPersistenceRuntime({store,backend=null,getContext=()=>null,enabled=false,now=Date.now,uuid=()=>crypto.randomUUID(),timeoutMs=15000,leaseMs=60000,maxAttempts=5,onChange=()=>{}}) {
  let active=enabled===true,flight=null,generation=0;
  const owner=uuid(), mode=()=>!active?'local':typeof backend?.execute==='function'?'persistent':'blocked';
  const context=()=>{const value=getContext();if(!value?.userId||!value?.householdId)fail('UNAUTHORIZED');return {userId:identity(value.userId),householdId:identity(value.householdId)};};
  const belongs=(row,ctx)=>row.userId===ctx.userId&&row.householdId===ctx.householdId;
  const changed=()=>{try{onChange();}catch{/* UI failure never changes transaction outcome. */}};
  async function enqueue(type,payload,{operationId=uuid(),baseRevision=null}={}) {
    const ctx=context(),id=identity(operationId),clean=validateOperation(type,payload,baseRevision);
    const request={type,payload:clean,baseRevision:structuredClone(baseRevision),...ctx};
    const row=await store.update(id,old=>{
      if(old){if(canonical({type:old.type,payload:old.payload,baseRevision:old.baseRevision,userId:old.userId,householdId:old.householdId})!==canonical(request))fail('DUPLICATE_OPERATION');return old;}
      return {id,idempotencyKey:id,...request,createdAt:new Date(now()).toISOString(),attempts:0,state:'pending',lastError:null,nextAttemptAt:0,leaseUntil:0};
    });changed();return row;
  }
  async function list(){const ctx=context();return (await store.list()).filter(row=>belongs(row,ctx)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));}
  async function send(row,ctx) {
    const controller=new AbortController();let timer;
    try { return await Promise.race([Promise.resolve().then(()=>backend.execute(structuredClone(row),ctx,controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TreasuryError('BACKEND_UNAVAILABLE'));},timeoutMs);})]); }
    finally {clearTimeout(timer);}
  }
  async function run() {
    if(mode()!=='persistent')return [];
    const ctx=context(),start=generation,rows=await list();
    for(const candidate of rows) {
      if(mode()!=='persistent'||generation!==start||canonical(getContext())!==canonical(ctx))break;
      let claimed=false;
      const row=await store.update(candidate.id,old=>{
        if(old?.state==='syncing'&&old.leaseUntil<=now()&&old.attempts>=maxAttempts)return {...old,state:'retryable_error',leaseOwner:null,leaseUntil:0,lastError:{code:'BACKEND_UNAVAILABLE',message:'Se agotaron los intentos. Conservamos la operación y su identidad para revisión.'}};
        if(!old||!belongs(old,ctx)||old.resolution||old.attempts>=maxAttempts||['confirmed','conflict','permanent_error'].includes(old.state)||old.nextAttemptAt>now()||(old.state==='syncing'&&old.leaseUntil>now()))return old;
        claimed=true;return {...old,state:'syncing',attempts:old.attempts+1,leaseOwner:owner,leaseUntil:now()+Math.max(leaseMs,timeoutMs*2)};
      });
      if(!claimed)continue;
      changed();
      // The context may change while the IndexedDB transaction is pending.
      if(mode()!=='persistent'||generation!==start||canonical(getContext())!==canonical(ctx)){
        await store.update(row.id,old=>old?.leaseOwner===owner?{...old,state:'pending',attempts:old.attempts-1,leaseUntil:0,leaseOwner:null}:old);break;
      }
      try {
        const result=await send(row,ctx);
        // Save the receipt for its original owner even after logout; never display it in another household.
        await store.update(row.id,old=>old?.leaseOwner===owner?{...old,state:'confirmed',result:structuredClone(result),lastError:null,leaseUntil:0,leaseOwner:null}:old);
      } catch(error) {
        const failure=classifyError(error),retry=failure.code==='BACKEND_UNAVAILABLE';
        const conflict=['ALREADY_CONFIRMED','ALREADY_REVOKED','STALE_VERSION','HOUSEHOLD_MISMATCH','ACCOUNT_MISMATCH','OCCURRENCE_CONFLICT','DUPLICATE_OPERATION','SOURCE_CHANGED'].includes(failure.code);
        await store.update(row.id,old=>old?.leaseOwner===owner?{...old,state:retry?'retryable_error':conflict?'conflict':'permanent_error',lastError:{code:failure.code,message:failure.message,details:failure.details},nextAttemptAt:retry?now()+Math.min(300000,1000*2**(old.attempts-1)):0,leaseUntil:0,leaseOwner:null}:old);
      }changed();
    }
    return canonical(getContext())===canonical(ctx)?list():[];
  }
  function syncPendingOperations(){if(!flight)flight=run().finally(()=>{flight=null;});return flight;}
  async function loadTreasuryState(){if(mode()!=='persistent')fail('DISABLED');const ctx=context(),start=generation;const result=await send({type:'read'},ctx);if(start!==generation||canonical(getContext())!==canonical(ctx))fail('UNAUTHORIZED');return result;}
  // A conflict is never rebased automatically. Accepting remote state retains both
  // the rejected proposal and the server evidence; a new proposal gets a NEW identity.
  async function acknowledgeConflict(id){const ctx=context();const result=await store.update(identity(id),old=>{if(!old||!belongs(old,ctx))fail('UNAUTHORIZED');if(old.state!=='conflict')fail('INVALID_PAYLOAD');return {...old,resolution:'remote_accepted',resolvedAt:new Date(now()).toISOString()};});changed();return result;}
  async function retryOperation(id){const ctx=context();const result=await store.update(identity(id),old=>{if(!old||!belongs(old,ctx))fail('UNAUTHORIZED');if(old.state!=='retryable_error'&&!(old.state==='permanent_error'&&old.lastError?.code==='UNAUTHORIZED'))fail('INVALID_PAYLOAD');return {...old,state:'pending',attempts:0,retryRounds:(old.retryRounds||0)+1,nextAttemptAt:0};});changed();return result;}
  return Object.freeze({mode,enqueue,list,syncPendingOperations,loadTreasuryState,acknowledgeConflict,retryOperation,
    createImport:(payload,options)=>enqueue('import',payload,options),
    createCheckpoint:(payload,options)=>enqueue('checkpoint',payload,options),
    confirmReconciliation:(payload,options)=>enqueue('confirm',payload,options),
    revokeReconciliation:(payload,options)=>enqueue('revoke',payload,options),
    setEnabled(value){active=value===true;generation++;changed();}
  });
}
