const DAY = 86_400_000;
const cents = value => Math.round(Number(value || 0) * 100);
const iso = value => String(value || '').slice(0, 10);
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const daysApart = (a, b) => Math.abs((Date.parse(`${iso(a)}T00:00:00Z`) - Date.parse(`${iso(b)}T00:00:00Z`)) / DAY);

function tokens(value) { return new Set(norm(value).split(' ').filter(token => token.length > 2)); }
function textScore(a, b) {
  const aa = tokens(a), bb = tokens(b); if (!aa.size || !bb.size) return 0;
  const common = [...aa].filter(token => bb.has(token)).length;
  return Math.round(common / Math.max(aa.size, bb.size) * 20);
}

export function statementSignedAmount(row) {
  if (row.signedAmount != null) return Number(row.signedAmount);
  const amount = Math.abs(Number(row.amount || 0));
  if (row.type) return row.type === 'income' ? amount : -amount;
  return Number(row.amount || 0);
}

export function movementMatchScore(statement, movement) {
  const bank = cents(statementSignedAmount(statement)), domus = cents(movement.signedAmount);
  if (!bank || bank !== domus) return 0;
  const distance = daysApart(statement.date, movement.date);
  if (!Number.isFinite(distance) || distance > 5) return 0;
  let score = 60 + Math.max(0, 20 - distance * 4);
  score += textScore(`${statement.concept || ''} ${statement.reference || ''}`, `${movement.concept || ''} ${movement.source?.invoice_number || ''} ${movement.source?.counterparty || ''}`);
  if (statement.reference && movement.source?.invoice_number && norm(statement.reference) === norm(movement.source.invoice_number)) score += 20;
  return Math.min(100, score);
}

export function reconcileStatement(statementRows, movements) {
  const reserved = new Set();
  return statementRows.map((statement, index) => {
    const candidates = movements.filter(movement => !reserved.has(movement.id)).map(movement => ({ movement, score: movementMatchScore(statement, movement) })).filter(candidate => candidate.score >= 60).sort((a, b) => b.score - a.score || String(a.movement.id).localeCompare(String(b.movement.id)));
    const best = candidates[0], second = candidates[1];
    const status = !best ? 'sin_coincidencia' : second && best.score - second.score < 10 ? 'ambiguo' : best.score >= 80 ? 'propuesto' : 'revisar';
    if (status === 'propuesto') reserved.add(best.movement.id);
    return Object.freeze({ statement: Object.freeze({ ...statement, id: statement.id || `statement-${index + 1}` }), status, candidate: best?.movement || null, score: best?.score || 0, alternatives: candidates.slice(1, 4) });
  });
}

export function computeConfirmedBalance(account, realMovements, asOf = new Date()) {
  const amount = account.opening_balance ?? account.confirmed_balance;
  const date = account.opening_balance_date ?? account.balance_confirmed_at;
  if (amount == null || !date) return Object.freeze({ available: false, reason: 'Falta saldo inicial confirmado o su fecha', balance: null, movements: 0 });
  const cutoff = iso(asOf), openingDate = iso(date);
  const rows = realMovements.filter(row => row.accountId === account.id && row.date > openingDate && row.date <= cutoff);
  const flow = rows.reduce((total, row) => total + Number(row.signedAmount || 0), 0), balance = Number(amount) + flow;
  return Object.freeze({ available: true, openingBalance: Number(amount), openingDate, flow: Math.round((flow + Number.EPSILON) * 100) / 100, balance: Math.round((balance + Number.EPSILON) * 100) / 100, movements: rows.length });
}

export function reconciliationSummary(results) {
  return results.reduce((out, row) => { out[row.status] = (out[row.status] || 0) + 1; out.total += 1; return out; }, { total: 0, propuesto: 0, revisar: 0, ambiguo: 0, sin_coincidencia: 0 });
}
