// Local proposal only: this module has no database or storage client.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value, label) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} no válido`);
  return value.toLowerCase();
}
function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) throw new Error('Fecha no válida');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Fecha no válida');
  return value;
}

// numeric(14,2): reject excess precision instead of silently rounding a balance.
export function checkpointDecimal(value) {
  if (!['string', 'number'].includes(typeof value)) throw new Error('Saldo no válido');
  const text = String(value).trim();
  if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(text)) throw new Error('Saldo no válido: máximo 12 enteros y 2 decimales');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return `${text.startsWith('-') && cents !== 0n ? '-' : ''}${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

export function buildCheckpointDraft({ householdId, account, amount, date, note = '', asOf, generatedAt = new Date() }) {
  const household = uuid(householdId, 'Hogar'), accountId = uuid(account?.id, 'Cuenta');
  if (uuid(account?.household_id, 'Hogar de la cuenta') !== household) throw new Error('La cuenta no pertenece al hogar activo');
  const balanceDate = dateOnly(date), cutoff = dateOnly(asOf);
  if (balanceDate > cutoff) throw new Error('El saldo no puede tener fecha futura');
  if (typeof note !== 'string') throw new Error('Nota no válida');
  const timestamp = new Date(generatedAt);
  if (!Number.isFinite(timestamp.getTime())) throw new Error('Fecha de generación no válida');
  return Object.freeze({
    format: 'domus-account-balance-checkpoint-draft',
    version: 1,
    persisted: false,
    requiresAuthorization: true,
    generatedAt: timestamp.toISOString(),
    target: 'account_balance_checkpoints',
    // Audit identity and timestamps must eventually come from the authenticated server.
    proposal: Object.freeze({ household_id: household, account_id: accountId, balance_date: balanceDate,
      balance: checkpointDecimal(amount), currency: 'EUR', source: 'manual', note: note.trim() || null })
  });
}
