const iso = value => String(value instanceof Date ? value.toISOString() : value || '').slice(0, 10);
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const validDate = value => { const text = iso(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false; const parsed = new Date(`${text}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text; };

export function createLocalCheckpoint({ accountId, amount, date, note = '' }, asOf = new Date()) {
  if (String(amount ?? '').trim() === '') throw new Error('El saldo debe ser un importe válido');
  const parsed = Number(amount), checkpointDate = iso(date), cutoff = iso(asOf);
  if (!accountId) throw new Error('Selecciona una cuenta');
  if (!Number.isFinite(parsed)) throw new Error('El saldo debe ser un importe válido');
  if (!validDate(checkpointDate)) throw new Error('La fecha del saldo no es válida');
  if (checkpointDate > cutoff) throw new Error('El saldo inicial no puede tener fecha futura');
  return Object.freeze({ accountId, amount: money(parsed), date: checkpointDate, note: String(note || '').trim(), source: 'captura_local_no_persistida' });
}

export function accountWithLocalCheckpoint(account, checkpoint) {
  if (!checkpoint || checkpoint.accountId !== account.id) return Object.freeze({ ...account });
  return Object.freeze({ ...account, opening_balance: checkpoint.amount, opening_balance_date: checkpoint.date });
}

export function validateAccountReconciliation({ account, checkpoint, realMovements, bankBalance, bankBalanceDate }, asOf = new Date()) {
  if (String(bankBalance ?? '').trim() === '') throw new Error('El saldo bancario final debe ser un importe válido');
  const closing = Number(bankBalance), closingDate = iso(bankBalanceDate), cutoff = iso(asOf);
  if (!checkpoint || checkpoint.accountId !== account.id) throw new Error('Primero registra un saldo inicial local para la cuenta');
  if (!Number.isFinite(closing)) throw new Error('El saldo bancario final debe ser un importe válido');
  if (!validDate(closingDate)) throw new Error('La fecha del saldo bancario final no es válida');
  if (closingDate < checkpoint.date) throw new Error('La fecha final no puede ser anterior al saldo inicial');
  if (closingDate > cutoff) throw new Error('La fecha final no puede ser futura');
  const included = realMovements.filter(row => row.accountId === account.id && row.date > checkpoint.date && row.date <= closingDate);
  const realFlow = money(included.reduce((total, row) => total + Number(row.signedAmount || 0), 0));
  const calculatedBalance = money(checkpoint.amount + realFlow), observedBalance = money(closing), difference = money(observedBalance - calculatedBalance);
  return Object.freeze({ accountId: account.id, openingBalance: checkpoint.amount, openingDate: checkpoint.date, closingDate, observedBalance, realFlow, calculatedBalance, difference, balanced: Math.abs(difference) < 0.01, movements: included.length });
}
