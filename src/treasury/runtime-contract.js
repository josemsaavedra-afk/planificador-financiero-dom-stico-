import { parseStatementCsv, parseBankDate } from './statement-csv.js';
import { checkpointDecimal } from './checkpoint-draft.js';

const messages = Object.freeze({
  ALREADY_CONFIRMED: 'Esta línea ya está conciliada. Revisa el historial.',
  ALREADY_REVOKED: 'Esta conciliación ya se revocó. Revisa el historial.',
  STALE_VERSION: 'Los datos han cambiado desde tu revisión. Revisa ambas versiones.',
  HOUSEHOLD_MISMATCH: 'La operación pertenece a otro hogar o has perdido el acceso.',
  ACCOUNT_MISMATCH: 'La cuenta no coincide con el extracto o el movimiento.',
  OCCURRENCE_CONFLICT: 'El movimiento no está disponible para esta conciliación.',
  DUPLICATE_OPERATION: 'Esta identidad de operación ya corresponde a otros datos.',
  SOURCE_CHANGED: 'El extracto ha cambiado. Conservamos tu propuesta para revisarla.',
  BACKEND_UNAVAILABLE: 'No se pudo confirmar la respuesta. Se conserva la operación para reintentar.',
  UNAUTHORIZED: 'Inicia sesión con el usuario que preparó la operación.',
  INVALID_PAYLOAD: 'La operación está incompleta o contiene datos no admitidos.',
  INTEGRITY_VIOLATION: 'No se puede guardar sin romper la coherencia del historial.',
  DISABLED: 'La persistencia remota está desactivada.',
  STORAGE_UNAVAILABLE: 'No se pudo conservar la operación en este dispositivo. No se ha enviado.'
});
export class TreasuryError extends Error {
  constructor(code, details = null) { super(messages[code] || messages.INTEGRITY_VIOLATION);this.name='TreasuryError';this.code=messages[code]?code:'INTEGRITY_VIOLATION';this.details=details; }
}
export const fail = (code, details) => { throw new TreasuryError(code, details); };
export function classifyError(error) {
  if(error instanceof TreasuryError)return error;
  if(error?.name==='AbortError'||error?.name==='TimeoutError'||error instanceof TypeError||error?.status>=500||['ECONNRESET','ETIMEDOUT','08006','40001','40P01'].includes(error?.code))return new TreasuryError('BACKEND_UNAVAILABLE');
  if(error?.status===401||error?.status===403||error?.code==='42501')return new TreasuryError('UNAUTHORIZED');
  return new TreasuryError('INTEGRITY_VIOLATION');
}
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value; }
export function identity(value) { if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))fail('INVALID_PAYLOAD');return value.toLowerCase(); }
const fields = {
  import:['accountId','fileName','csv'], checkpoint:['accountId','amount','date','note'],
  confirm:['id','accountId','statementLineId','seriesId','occurrenceDate'], revoke:['id','reason']
};
export function validateOperation(type, payload, baseRevision = null) {
  if(!fields[type]||!payload||Object.getPrototypeOf(payload)!==Object.prototype||Object.keys(payload).some(key=>!fields[type].includes(key)))fail('INVALID_PAYLOAD');
  const clean=structuredClone(payload);
  for(const key of ['accountId','id','statementLineId','seriesId'])if(fields[type].includes(key))clean[key]=identity(clean[key]);
  try {
    if(type==='import') { if(typeof clean.csv!=='string'||new TextEncoder().encode(clean.csv).length>5*1024*1024)fail('INVALID_PAYLOAD');parseStatementCsv(clean.csv);if(clean.fileName!=null&&(typeof clean.fileName!=='string'||clean.fileName.length>255))fail('INVALID_PAYLOAD'); }
    if(type==='checkpoint') { clean.date=parseBankDate(clean.date);checkpointDecimal(clean.amount);if(clean.note!=null&&(typeof clean.note!=='string'||clean.note.length>2000))fail('INVALID_PAYLOAD'); }
    if(type==='confirm') { clean.occurrenceDate=parseBankDate(clean.occurrenceDate);if(!baseRevision||Object.keys(baseRevision).sort().join(',')!=='lineHash,occurrence,series'||![baseRevision.series,baseRevision.occurrence].every(n=>Number.isSafeInteger(n)&&n>0)||!/^[a-f0-9]{64}$/.test(baseRevision.lineHash))fail('INVALID_PAYLOAD'); }
    if(type==='revoke') { if(typeof clean.reason!=='string'||!clean.reason.trim()||clean.reason.length>2000||!Number.isSafeInteger(baseRevision)||baseRevision<1)fail('INVALID_PAYLOAD');clean.reason=clean.reason.trim(); }
    if(['import','checkpoint'].includes(type)&&baseRevision!==null)fail('INVALID_PAYLOAD');
  } catch(error) { if(error instanceof TreasuryError)throw error;fail('INVALID_PAYLOAD'); }
  return clean;
}
export const queueLabels=Object.freeze({pending:'Pendiente de sincronización',syncing:'Sincronizando',confirmed:'Sincronizado',conflict:'Requiere revisión',retryable_error:'Error recuperable',permanent_error:'No se puede enviar'});
