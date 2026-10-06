// Pure, side-effect-free TransportERP -> DOMUS boundary. No network or production access.
export const CONTRACT_VERSION = 1;
const types = new Set(['invoice','expense','payment','receipt','transfer','settlement','credit_note']);
const statuses = new Set(['pending','confirmed','corrected','cancelled']);
const money = n => Number.isSafeInteger(n) && Math.abs(n) <= 999999999999;
const required = (s, field) => {
  if (typeof s !== 'string' || !s.trim() || s.length > 160) throw new TypeError(field + ' must be a nonempty string of at most 160 characters');
  return s.trim();
};
const nullable = (s, field) => s == null ? null : required(s, field);
export function normalizeTransportERPRecord(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Record must be an object');
  if (raw.contract_version !== CONTRACT_VERSION) throw new RangeError('Unsupported contract version');
  if (raw.source_system !== 'TransportERP') throw new TypeError('Unsupported source system');
  const source_entity_type = required(raw.source_entity_type, 'source_entity_type');
  if (!types.has(source_entity_type)) throw new TypeError('Unknown entity type');
  const status = required(raw.status, 'status');
  if (!statuses.has(status)) throw new TypeError('Unknown status');
  if (!Number.isSafeInteger(raw.source_revision) || raw.source_revision < 1) throw new TypeError('Invalid revision');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || !Number.isFinite(Date.parse(raw.date + 'T12:00:00Z')) || new Date(raw.date + 'T12:00:00Z').toISOString().slice(0,10) !== raw.date) throw new TypeError('Invalid date');
  if (!money(raw.amount_cents)) throw new TypeError('Use integer amount_cents, not floating point euros');
  const record = {
    contract_version: CONTRACT_VERSION,
    source_system: 'TransportERP',
    source_entity_type,
    source_entity_id: required(raw.source_entity_id, 'source_entity_id'),
    source_revision: raw.source_revision,
    household_id: required(raw.household_id, 'household_id'),
    activity_id: nullable(raw.activity_id, 'activity_id'),
    external_document_id: nullable(raw.external_document_id, 'external_document_id'),
    date: raw.date,
    amount_cents: raw.amount_cents,
    currency: 'EUR',
    status,
    related_source_entity_ids: [...new Set((raw.related_source_entity_ids || []).map(id => required(id, 'related_source_entity_ids')))]
  };
  if (raw.currency !== 'EUR') throw new TypeError('Only EUR is supported');
  if (!Array.isArray(raw.related_source_entity_ids || [])) throw new TypeError('Invalid related entities');
  return Object.freeze(record);
}
export function transportERPIdentity(record) {
  return [record.source_system, record.household_id, record.source_entity_type, record.source_entity_id].map(s => encodeURIComponent(s)).join(':');
}
// Pure decision only: caller must authorize household membership and commit atomically with a unique identity constraint.
export function planTransportERPImport(raw, previous = null) {
  const incoming = normalizeTransportERPRecord(raw);
  const identity = transportERPIdentity(incoming);
  if (!previous) return { action: 'insert', identity, record: incoming };
  if (transportERPIdentity(previous) !== identity) throw new Error('Cross-entity or cross-household update denied');
  if (incoming.source_revision < previous.source_revision) return { action: 'stale', identity, record: previous };
  if (incoming.source_revision === previous.source_revision) {
    if (JSON.stringify(incoming) !== JSON.stringify(normalizeTransportERPRecord(previous))) throw new Error('Conflicting payload for same revision');
    return { action: 'unchanged', identity, record: previous };
  }
  return { action: 'update', identity, record: incoming };
}
// A document is not a cash flow. Only receipts/payments are candidates for bank reconciliation.
export const isBankCashFlow = record => record.source_entity_type === 'receipt' || record.source_entity_type === 'payment' || record.source_entity_type === 'transfer';
