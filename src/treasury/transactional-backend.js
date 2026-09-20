import {createSqlTreasuryBackend} from './sql-persistence.js';
import {identity,validateOperation,canonical,fail,classifyError,TreasuryError} from './runtime-contract.js';

// SERVER ONLY. transaction must establish domus_treasury_executor (NO BYPASSRLS),
// and auth.uid() from a VERIFIED session. Neither role nor actor come from payload.
// One callback = one database transaction, including the immutable receipt.
export function createTransactionalTreasuryBackend({transaction}) {
  return Object.freeze({async execute(envelope,context,signal) {
    const household=identity(context.householdId),user=identity(context.userId);
    const type=envelope.type;
    const payload=type==='read'?{}:validateOperation(type,envelope.payload,envelope.baseRevision);
    const operationId=type==='read'?null:identity(envelope.idempotencyKey);
    if(type!=='read'&&identity(envelope.id)!==operationId)fail('DUPLICATE_OPERATION');
    const request={type,payload,baseRevision:envelope.baseRevision??null};
    try {return await transaction(async tx=>{
      const query=async(sql,args=[])=>{if(signal?.aborted)fail('BACKEND_UNAVAILABLE');return (await tx.query(sql,args)).rows;};
      const actor=(await query('select auth.uid() as id'))[0]?.id;
      if(actor!==user)fail('UNAUTHORIZED');
      // Lock order is shared with source revision triggers. Hash collisions serialize
      // unrelated homes harmlessly; the authorization checks still use exact UUIDs.
      await query('select pg_advisory_xact_lock(hashtextextended($1,18))',[household]);
      if(!(await query('select private.is_household_member($1) as member',[household]))[0]?.member)fail('HOUSEHOLD_MISMATCH');
      if(type==='read') {
        const imports=await query('select * from public.bank_statement_imports where household_id=$1 order by imported_at,id',[household]);
        const lines=await query('select l.* from public.bank_statement_lines l join public.bank_statement_imports i on i.id=l.import_id where i.household_id=$1 order by l.import_id,l.line_ordinal',[household]);
        const checkpoints=await query('select * from public.account_balance_checkpoints where household_id=$1 order by balance_date,id',[household]);
        const reconciliations=await query('select * from public.treasury_reconciliations where household_id=$1 order by confirmed_at,id',[household]);
        const sources=await query('select s.id as series_id,s.account_id,s.treasury_revision as series,o.occurrence_date,o.treasury_revision as occurrence from public.movement_series s join public.movement_occurrence_states o on o.series_id=s.id where s.household_id=$1 order by s.id,o.occurrence_date',[household]);
        return JSON.parse(JSON.stringify({householdId:household,imports,lines,checkpoints,reconciliations,sources}));
      }
      const receipt=(await query('select request,response from private.treasury_operation_receipts where actor_id=$1 and household_id=$2 and operation_id=$3',[user,household,operationId]))[0];
      if(receipt){if(canonical(receipt.request)!==canonical(request))fail('DUPLICATE_OPERATION');return receipt.response;}
      if(payload.accountId&&!(await query('select id from public.accounts where id=$1 and household_id=$2',[payload.accountId,household])).length)fail('ACCOUNT_MISMATCH');
      if(type==='confirm') {
        const line=(await query('select l.*,i.account_id from public.bank_statement_lines l join public.bank_statement_imports i on i.id=l.import_id where l.id=$1 and i.household_id=$2',[payload.statementLineId,household]))[0];
        if(!line||line.account_id!==payload.accountId)fail('ACCOUNT_MISMATCH');
        if(line.content_sha256!==envelope.baseRevision.lineHash)fail('SOURCE_CHANGED',{lineHash:line.content_sha256});
        const source=(await query('select s.account_id,s.treasury_revision as series,o.treasury_revision as occurrence from public.movement_series s join public.movement_occurrence_states o on o.series_id=s.id where s.id=$1 and o.occurrence_date=$2 and s.household_id=$3',[payload.seriesId,payload.occurrenceDate,household]))[0];
        if(!source)fail('OCCURRENCE_CONFLICT');
        if(source.account_id!==payload.accountId)fail('ACCOUNT_MISMATCH');
        if(source.series!==envelope.baseRevision.series||source.occurrence!==envelope.baseRevision.occurrence)fail('STALE_VERSION',source);
        const previous=(await query('select * from public.treasury_reconciliations where id=$1',[payload.id]))[0];
        if(previous)fail(previous.status==='revoked'?'ALREADY_REVOKED':'ALREADY_CONFIRMED',previous);
        const active=(await query("select * from public.treasury_reconciliations where status='confirmed' and (statement_line_id=$1 or (movement_series_id=$2 and occurrence_date=$3))",[payload.statementLineId,payload.seriesId,payload.occurrenceDate]))[0];
        if(active)fail(active.statement_line_id===payload.statementLineId?'ALREADY_CONFIRMED':'OCCURRENCE_CONFLICT',active);
      }
      if(type==='revoke') {
        const current=(await query('select * from public.treasury_reconciliations where id=$1 and household_id=$2',[payload.id,household]))[0];
        if(!current)fail('OCCURRENCE_CONFLICT');
        if(current.status==='revoked')fail('ALREADY_REVOKED',current);
        if(current.treasury_revision!==envelope.baseRevision)fail('STALE_VERSION',current);
      }
      const legacy=createSqlTreasuryBackend({transaction:fn=>fn({query:(sql,args)=>tx.query(sql,args)})});
      let result;
      try {result=await legacy.execute(type,payload,{userId:user,householdId:household},signal);}
      catch(error){if(error.message?.startsWith('Conflicto'))fail(type==='import'?'SOURCE_CHANGED':'STALE_VERSION');throw error;}
      // JSON receipt and initial response use identical serializable representation.
      result=JSON.parse(JSON.stringify(result));
      await query('insert into private.treasury_operation_receipts(actor_id,household_id,operation_id,request,response) values($1,$2,$3,$4,$5)',[user,household,operationId,JSON.stringify(request),JSON.stringify(result)]);
      return result;
    });} catch(error){if(error instanceof TreasuryError)throw error;throw classifyError(error);}
  }});
}

// Hosting integration point. Authentication and transaction setup are supplied by
// trusted server middleware; a caller cannot supply a context/user in the request.
export function createTreasuryRequestHandler({authenticate,transaction}) {
  return async (request,signal)=>{
    const session=await authenticate(request);
    if(!session?.userId)fail('UNAUTHORIZED');
    const body=request.body;
    if(!body||identity(body.actorId)!==identity(session.userId))fail('UNAUTHORIZED');
    const context={userId:identity(session.userId),householdId:identity(body.householdId)};
    const backend=createTransactionalTreasuryBackend({transaction:fn=>transaction(session,fn)});
    return backend.execute(body.operation,context,signal);
  };
}
