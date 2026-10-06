import { parseStatementCsv, parseBankDate } from './statement-csv.js';
import { createStatementFingerprint } from './reconciliation-report.js';
import { buildCheckpointDraft, checkpointDecimal } from './checkpoint-draft.js';

const uuid = value => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')) throw new Error('Identidad no válida');return value.toLowerCase(); };
const conflict = () => { throw new Error('Conflicto de persistencia: conservar borrador y consultar historial'); };
// Server-side port, exercised with PGlite. transaction MUST provide an authenticated
// SQL transaction with RLS; it must never derive its JWT actor from the payload.
// No HTTP transport or production client is supplied by this module.
export function createSqlTreasuryBackend({ transaction }) {
  return Object.freeze({ async execute(operation, input, context, signal) {
    const household = uuid(context.householdId), user = uuid(context.userId);
    const parsed = operation === 'import' ? parseStatementCsv(input.csv) : null;
    const fingerprint = parsed ? await createStatementFingerprint(uuid(input.accountId), input.csv) : null;
    const hashes = parsed ? await Promise.all(parsed.map(row => createStatementFingerprint(input.accountId, JSON.stringify([row.date,row.concept,row.reference,row.signedAmount])))) : null;
    return transaction(async tx => {
      const query = async (sql, args=[]) => { if(signal?.aborted)throw new Error('Operación cancelada');return (await tx.query(sql,args)).rows; };
      const actor=(await query('select auth.uid() as id'))[0]?.id;
      if(actor !== user)throw new Error('Actor de sesión no coincide');
      if(!(await query('select private.is_household_member($1) as member',[household]))[0]?.member)throw new Error('Acceso al hogar revocado');
      const account = async id => { const row=(await query('select id,household_id from public.accounts where id=$1 and household_id=$2',[uuid(id),household]))[0];if(!row)throw new Error('Cuenta no accesible');return row; };
      if(operation === 'import') {
        await account(input.accountId);
        let imported=(await query('select * from public.bank_statement_imports where household_id=$1 and account_id=$2 and content_sha256=$3',[household,input.accountId,fingerprint.contentSha256]))[0];
        if(!imported) {
          imported=(await query('insert into public.bank_statement_imports(household_id,account_id,file_name,content_sha256,line_count) values($1,$2,$3,$4,$5) returning *',[household,input.accountId,String(input.fileName || 'extracto.csv').slice(0,255),fingerprint.contentSha256,parsed.length]))[0];
          for(let i=0;i<parsed.length;i++){const row=parsed[i];await query('insert into public.bank_statement_lines(import_id,line_ordinal,transaction_date,concept,reference,signed_amount,content_sha256) values($1,$2,$3,$4,$5,$6,$7)',[imported.id,row.ordinal,row.date,row.concept,row.reference,checkpointDecimal(row.signedAmount),hashes[i].contentSha256]);}
        }
        const lines=await query('select * from public.bank_statement_lines where import_id=$1 order by line_ordinal',[imported.id]);
        if(imported.line_count!==parsed.length||lines.length!==parsed.length||lines.some((row,i)=>row.line_ordinal!==parsed[i].ordinal||row.content_sha256!==hashes[i].contentSha256))conflict();
        return {import:imported,lines};
      }
      if(operation === 'checkpoint') {
        const proposal=buildCheckpointDraft({householdId:household,account:await account(input.accountId),amount:input.amount,date:input.date,note:input.note,asOf:new Date().toISOString().slice(0,10)}).proposal;
        const old=(await query("select * from public.account_balance_checkpoints where account_id=$1 and balance_date=$2 and source='manual'",[proposal.account_id,proposal.balance_date]))[0];
        if(old){if(old.balance!==proposal.balance||old.note!==proposal.note)conflict();return old;}
        return (await query('insert into public.account_balance_checkpoints(household_id,account_id,balance_date,balance,source,note) values($1,$2,$3,$4,$5,$6) returning *',[household,proposal.account_id,proposal.balance_date,proposal.balance,proposal.source,proposal.note]))[0];
      }
      if(operation === 'confirm') {
        const id=uuid(input.id),line=uuid(input.statementLineId),series=uuid(input.seriesId),date=parseBankDate(input.occurrenceDate);
        const old=(await query('select * from public.treasury_reconciliations where id=$1',[id]))[0];
        if(old){if(old.household_id!==household||old.statement_line_id!==line||old.movement_series_id!==series||new Date(old.occurrence_date).toISOString().slice(0,10)!==date||old.status!=='confirmed')conflict();return old;}
        return (await query('insert into public.treasury_reconciliations(id,household_id,statement_line_id,movement_series_id,occurrence_date) values($1,$2,$3,$4,$5) returning *',[id,household,line,series,date]))[0];
      }
      if(operation === 'revoke') {
        const id=uuid(input.id),reason=String(input.reason||'').trim();if(!reason)throw new Error('Motivo requerido');
        const old=(await query('select * from public.treasury_reconciliations where id=$1 and household_id=$2',[id,household]))[0];
        if(!old)throw new Error('Conciliación no accesible');
        if(old.status==='revoked'){if(old.revocation_reason!==reason)conflict();return old;}
        const updated=(await query("update public.treasury_reconciliations set status='revoked',revoked_by=auth.uid(),revocation_reason=$1 where id=$2 and status='confirmed' returning *",[reason,id]))[0];
        if(updated)return updated;
        const winner=(await query('select * from public.treasury_reconciliations where id=$1 and household_id=$2',[id,household]))[0];
        if(winner?.status==='revoked'&&winner.revocation_reason===reason)return winner;
        conflict();
      }
      if(operation === 'read')return query('select * from public.treasury_reconciliations where household_id=$1 order by confirmed_at,id',[household]);
      throw new Error('Operación no admitida');
    });
  } });
}
