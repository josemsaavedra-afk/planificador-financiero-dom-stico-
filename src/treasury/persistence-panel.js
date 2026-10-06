import {queueLabels,canonical,classifyError} from './runtime-contract.js';
import {sha256Hex} from './reconciliation-report.js';

async function stableIdentity(value){const hash=await sha256Hex(value);return hash.slice(0,8)+'-'+hash.slice(8,12)+'-8'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);}

// UI adapter: submits domain commands only. It has no database/Supabase dependency.
export function createPersistencePanel({runtime,getSnapshot,esc}) {
  let pending=new Map(),remote=null,contextKey=null;
  const context=()=>{const snapshot=getSnapshot();return snapshot?canonical([snapshot.userId,snapshot.householdId]):null;};
  const message=(node,text)=>{if(node)node.textContent=text;};
  function invalidate(){pending=new Map();remote=null;contextKey=null;}
  async function submit(type,payload,baseRevision=null) {
    const start=context();if(!start)throw Error('Inicia sesión para guardar.');
    const key=canonical([start,type,payload,baseRevision]);
    if(pending.has(key))return pending.get(key);
    const task=(async()=>{
      const old=(await runtime.list()).find(row=>!row.resolution&&canonical([type,payload,baseRevision])===canonical([row.type,row.payload,row.baseRevision]));
      if(context()!==start)throw Error('La sesión ha cambiado.');
      if(old)return old;
      const operationId=await stableIdentity(key);
      if(context()!==start)throw Error('La sesión ha cambiado.');
      return runtime.enqueue(type,payload,{baseRevision,operationId});
    })();pending.set(key,task);try{return await task;}finally{pending.delete(key);}
  }
  async function render(root) {
    const start=context();if(!start)return;
    let panel=root.querySelector('[data-treasury-outbox]');
    if(!panel){panel=document.createElement('section');panel.setAttribute('data-treasury-outbox','');panel.className='card';root.appendChild(panel);}
    try {
      const rows=await runtime.list();if(context()!==start||!panel.isConnected)return;
      panel.innerHTML='<h2>Guardado y sincronización</h2><p role="status" data-queue-message></p><div class="actions"><button class="btn primary" data-sync-treasury>Sincronizar pendientes</button><button class="btn" data-load-treasury>Consultar historial</button></div><div data-remote-history></div>'+rows.map(row=>'<article><p><strong>'+esc(queueLabels[row.state])+'</strong> · '+esc({import:'Extracto',checkpoint:'Saldo inicial',confirm:'Conciliación',revoke:'Revocación'}[row.type])+'</p>'+(row.lastError?'<p>'+esc(row.lastError.message)+'</p>':'')+(row.attempts>=5&&row.state==='retryable_error'?'<p>Se agotaron los intentos automáticos. Conservamos tu operación para revisión.</p>':'')+(row.state==='conflict'?'<details><summary>Revisar propuesta y respuesta</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify({propuesta:row.payload,respuesta:row.lastError?.details},null,2))+'</pre></details>'+(!row.resolution?'<button class="btn" data-accept-remote="'+esc(row.id)+'">Conservar historial remoto y archivar propuesta</button>':'<p>Propuesta archivada; historial remoto conservado.</p>'):'')+'</article>').join('');
      const output=panel.querySelector('[data-queue-message]');message(output,rows.length?'Las propuestas permanecen en este dispositivo hasta recibir confirmación.':'No hay operaciones pendientes.');
      const sync=panel.querySelector('[data-sync-treasury]');sync.disabled=runtime.mode()!=='persistent';sync.onclick=async()=>{if(sync.disabled||context()!==start)return;sync.disabled=true;message(output,'Sincronizando…');try{await runtime.syncPendingOperations();const state=await runtime.loadTreasuryState();if(context()===start){remote=state;contextKey=start;}}catch(error){message(output,classifyError(error).message);}finally{if(context()===start)await render(root);}};
      panel.querySelector('[data-load-treasury]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{const state=await runtime.loadTreasuryState();if(context()!==start)return;remote=state;contextKey=start;renderHistory(panel);message(output,'Historial actualizado. Revisa la propuesta antes de enviarla.');}catch(error){message(output,classifyError(error).message);}finally{button.disabled=false;}};
      panel.querySelectorAll('[data-accept-remote]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await runtime.acknowledgeConflict(button.dataset.acceptRemote);await render(root);}catch(error){message(output,classifyError(error).message);}});
      for(const row of rows.filter(row=>row.state==='retryable_error'||(row.state==='permanent_error'&&row.lastError?.code==='UNAUTHORIZED'))){const retry=document.createElement('button');retry.type='button';retry.className='btn';retry.textContent='Reintentar operación conservada';retry.onclick=async()=>{retry.disabled=true;try{await runtime.retryOperation(row.id);if(context()!==start)return;await runtime.syncPendingOperations();await render(root);}catch(error){message(output,classifyError(error).message);}};panel.appendChild(retry);}
      if(contextKey===start&&remote)renderHistory(panel);
    }catch(error){if(context()===start)panel.textContent=classifyError(error).message;}
  }
  function renderHistory(panel){
    const boundContext=context(),displayed=remote;
    const box=panel.querySelector('[data-remote-history]');
    box.innerHTML='<p>'+remote.checkpoints.length+' saldos · '+remote.imports.length+' extractos · '+remote.reconciliations.length+' conciliaciones en el historial.</p>'+remote.checkpoints.map(row=>'<p>Saldo guardado: '+esc(row.balance)+' EUR · '+esc(row.balance_date.slice(0,10))+'</p>').join('')+remote.imports.map(row=>'<p>Extracto guardado: '+esc(row.file_name)+' · '+row.line_count+' líneas</p>').join('')+remote.reconciliations.map(row=>'<div><span>'+esc(row.status==='revoked'?'Revocada':'Confirmada')+' · '+esc(row.occurrence_date?.slice(0,10))+'</span>'+(row.status==='confirmed'?'<label>Motivo de revocación<input data-revoke-reason="'+esc(row.id)+'" maxlength="2000"></label><button class="btn" data-revoke-id="'+esc(row.id)+'">Preparar revocación</button>':'')+'</div>').join('');
    box.querySelectorAll('[data-revoke-id]').forEach(button=>button.onclick=async()=>{if(button.disabled||context()!==boundContext)return;button.disabled=true;const row=displayed.reconciliations.find(r=>r.id===button.dataset.revokeId);try{await submit('revoke',{id:row.id,reason:box.querySelector('[data-revoke-reason="'+row.id+'"]').value},row.treasury_revision);message(panel.querySelector('[data-queue-message]'),'Revocación pendiente de sincronización.');}catch(error){message(panel.querySelector('[data-queue-message]'),classifyError(error).message);button.disabled=false;}});
  }
  function bindCheckpoint(box,account,asOf){
    const boundContext=context();
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Preparar guardado del saldo';button.setAttribute('data-enqueue-checkpoint','');box.appendChild(button);
    button.onclick=async()=>{if(button.disabled||context()!==boundContext)return;button.disabled=true;try{const value={accountId:account.id,amount:box.querySelector('[data-opening-amount]').value,date:box.querySelector('[data-opening-date]').value};if(value.date>asOf)throw Error('Revisa la fecha del saldo.');await submit('checkpoint',value);message(box.querySelector('[data-balance-result]'),'Saldo pendiente de sincronización.');}catch(error){message(box.querySelector('[data-balance-result]'),error.message);}finally{button.disabled=false;}};
  }
  function bindReview(output,entry){
    const boundContext=context();
    const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Preparar guardado del extracto';button.setAttribute('data-enqueue-import','');output.appendChild(button);
    const note=document.createElement('p');note.setAttribute('role','status');output.appendChild(note);
    button.onclick=async()=>{if(button.disabled||context()!==boundContext)return;button.disabled=true;try{await submit('import',{accountId:entry.metadata.account.id,fileName:entry.metadata.fileName,csv:entry.metadata.csv});message(note,'Extracto pendiente. Sincronízalo y consulta el historial antes de guardar sus conciliaciones.');}catch(error){message(note,classifyError(error).message);}finally{button.disabled=false;}};
    const confirm=document.createElement('button');confirm.type='button';confirm.className='btn';confirm.textContent='Preparar conciliaciones revisadas';confirm.setAttribute('data-enqueue-confirmations','');output.appendChild(confirm);
    confirm.onclick=async()=>{if(confirm.disabled||entry.stale||context()!==boundContext)return;confirm.disabled=true;try{
      if(!remote||contextKey!==context())throw Error('Consulta primero el historial actualizado.');
      const imported=remote.imports.find(row=>row.account_id===entry.metadata.account.id&&row.content_sha256===entry.metadata.fingerprint.contentSha256);
      if(!imported)throw Error('Sincroniza primero el extracto y consulta el historial.');
      const selected=entry.session.rows.filter(row=>row.decision==='confirmada');if(!selected.length)throw Error('Revisa y confirma primero alguna coincidencia local.');
      // Validate the whole selection before queueing any command; each confirmation
      // remains an independent, auditable transaction with its own stable identity.
      const commands=selected.map(row=>{
        const [seriesId,occurrenceDate]=row.selectedMovementId.split('|');
        const source=entry.confirmationBases?.[row.statement.id];
        const line=remote.lines.find(item=>item.import_id===imported.id&&item.line_ordinal===row.statement.ordinal);
        if(!source){entry.needsPersistentReview=true;throw Error('Consulta el historial y vuelve a seleccionar el CSV para una nueva revisión. Conservamos la revisión anterior.');}
        if(!source||!line)throw Error('El movimiento no está disponible en el historial. Revisa la selección.');
        return {line,seriesId,occurrenceDate,source};
      });
      for(const command of commands){
        const previous=(await runtime.list()).find(op=>op.type==='confirm'&&op.payload.statementLineId===command.line.id&&op.payload.seriesId===command.seriesId&&op.payload.occurrenceDate===command.occurrenceDate&&!op.resolution);
        if(context()!==boundContext)throw Error('La sesión ha cambiado.');
        if(previous)continue;
        const base={series:command.source.series,occurrence:command.source.occurrence,lineHash:command.source.lineHash};
        const confirmationId=await stableIdentity(canonical([boundContext,command.line.id,command.seriesId,command.occurrenceDate,base]));
        if(context()!==boundContext)throw Error('La sesión ha cambiado.');
        await submit('confirm',{id:confirmationId,accountId:entry.metadata.account.id,statementLineId:command.line.id,seriesId:command.seriesId,occurrenceDate:command.occurrenceDate},base);
      }message(note,'Conciliaciones pendientes de sincronización.');
    }catch(error){message(note,error.message);}finally{confirm.disabled=false;}};
  }
  function captureDecision(entry,statementId,session){
    if(!remote||contextKey!==context())return;
    const row=session.rows.find(row=>row.statement.id===statementId),[seriesId,occurrenceDate]=(row?.selectedMovementId||'').split('|');
    const source=remote.sources.find(item=>item.series_id===seriesId&&item.occurrence_date.slice(0,10)===occurrenceDate);
    const imported=remote.imports.find(item=>item.account_id===entry.metadata.account.id&&item.content_sha256===entry.metadata.fingerprint.contentSha256);
    const line=remote.lines.find(item=>item.import_id===imported?.id&&item.line_ordinal===row?.statement.ordinal);
    if(source&&line){entry.confirmationBases||={};entry.confirmationBases[statementId]={...structuredClone(source),lineHash:line.content_sha256};}
  }
  return Object.freeze({render,invalidate,bindCheckpoint,bindReview,captureDecision});
}
