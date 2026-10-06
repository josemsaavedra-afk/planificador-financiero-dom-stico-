const DAY = 86_400_000;

export const TREASURY_STATUS = Object.freeze({
  FORECAST: 'previsto',
  PENDING: 'pendiente',
  OVERDUE: 'vencido',
  COMPLETED: 'realizado',
  RESCHEDULED: 'reprogramado',
  PREFINANCED: 'prefinanciado',
  SETTLED: 'liquidado',
  CANCELLED: 'cancelado'
});

function dateOnly(value, field) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${field} debe ser una fecha ISO válida`);
  }
  return text;
}

function money(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) throw new TypeError('El importe debe ser numérico');
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function effectiveTreasuryDate(item) {
  return dateOnly(
    item.actual_date || item.settled_at || item.prefinanced_at || item.rescheduled_date ||
      item.expected_treasury_date || item.due_date || item.occurrence_date || item.start_date,
    'fecha de tesorería'
  );
}

export function classifyTreasuryStatus(item, asOf = new Date()) {
  const today = dateOnly(asOf, 'fecha de corte');
  const raw = String(item.status || 'pending').toLowerCase();
  if (raw === 'cancelled' || raw === 'cancelado') return TREASURY_STATUS.CANCELLED;
  if (raw === 'settled' || raw === 'liquidado' || item.liquidated === true) return TREASURY_STATUS.SETTLED;
  if (item.prefinanced === true) return TREASURY_STATUS.PREFINANCED;
  if (raw === 'done' || raw === 'realizado' || item.actual_date) return TREASURY_STATUS.COMPLETED;
  if (item.rescheduled_date) return TREASURY_STATUS.RESCHEDULED;
  const when = effectiveTreasuryDate(item);
  if (!when || when > today) return TREASURY_STATUS.FORECAST;
  if (when < today) return TREASURY_STATUS.OVERDUE;
  return TREASURY_STATUS.PENDING;
}

export function normalizeTreasuryItem(item, asOf = new Date()) {
  if (!item?.id && !item?.series_id) throw new TypeError('El movimiento necesita id o series_id');
  if (!['income', 'expense'].includes(item.type)) throw new TypeError('El tipo debe ser income o expense');
  const gross = money(item.amount_override ?? item.amount);
  const fee = money(item.prefinanced_fee);
  const net = item.prefinanced_net == null ? money(gross - fee) : money(item.prefinanced_net);
  const status = classifyTreasuryStatus(item, asOf);
  return Object.freeze({
    id: item.id || `${item.series_id}|${item.occurrence_date}`,
    seriesId: item.series_id || item.id,
    type: item.type,
    concept: item.concept || 'Sin concepto',
    accountId: item.account_id || null,
    personId: item.person_id || null,
    categoryId: item.category_id || null,
    date: effectiveTreasuryDate(item),
    originalDate: dateOnly(item.occurrence_date || item.start_date || item.due_date, 'fecha original'),
    status,
    gross,
    fee,
    amount: status === TREASURY_STATUS.PREFINANCED ? net : gross,
    signedAmount: (item.type === 'income' ? 1 : -1) *
      (status === TREASURY_STATUS.PREFINANCED ? net : gross),
    source: item
  });
}

export function buildTreasury(items, options = {}) {
  const asOf = options.asOf || new Date();
  const from = options.from ? dateOnly(options.from, 'desde') : null;
  const to = options.to ? dateOnly(options.to, 'hasta') : null;
  const includeCompleted = options.includeCompleted !== false;
  const normalized = items.map(item => normalizeTreasuryItem(item, asOf))
    .filter(item => item.status !== TREASURY_STATUS.CANCELLED)
    .filter(item => includeCompleted || ![TREASURY_STATUS.COMPLETED, TREASURY_STATUS.SETTLED].includes(item.status))
    .filter(item => (!from || item.date >= from) && (!to || item.date <= to))
    .sort((a, b) => (a.date || '9999-12-31').localeCompare(b.date || '9999-12-31') || a.id.localeCompare(b.id));

  const totals = normalized.reduce((out, item) => {
    out[item.type] = money(out[item.type] + item.amount);
    out.net = money(out.net + item.signedAmount);
    out.byStatus[item.status] = money((out.byStatus[item.status] || 0) + item.signedAmount);
    return out;
  }, { income: 0, expense: 0, net: 0, byStatus: {} });

  return Object.freeze({ asOf: dateOnly(asOf, 'fecha de corte'), items: normalized, totals });
}

export function projectAccountBalances(items, accounts = [], options = {}) {
  const treasury = buildTreasury(items, options);
  const opening = new Map(accounts.map(a => [a.id, money(a.opening_balance ?? a.balance ?? 0)]));
  const balances = new Map(opening);
  const timeline = treasury.items.map(item => {
    const key = item.accountId || 'unassigned';
    const balance = money((balances.get(key) || 0) + item.signedAmount);
    balances.set(key, balance);
    return Object.freeze({ ...item, balance });
  });
  return Object.freeze({ treasury, timeline, balances: Object.fromEntries(balances) });
}

export function treasuryHorizon(items, days, asOf = new Date()) {
  if (!Number.isInteger(days) || days < 0) throw new TypeError('El horizonte debe ser un entero positivo');
  const start = new Date(`${dateOnly(asOf, 'fecha de corte')}T00:00:00Z`);
  const end = new Date(start.getTime() + days * DAY).toISOString().slice(0, 10);
  return buildTreasury(items, { asOf, to: end, includeCompleted: false });
}
