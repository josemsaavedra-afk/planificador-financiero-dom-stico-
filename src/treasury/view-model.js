import { buildTreasury, TREASURY_STATUS } from './engine.js';
import { computeConfirmedBalance } from './reconciliation.js';

const OPEN = new Set([TREASURY_STATUS.FORECAST, TREASURY_STATUS.PENDING, TREASURY_STATUS.OVERDUE, TREASURY_STATUS.RESCHEDULED]);
const REAL = new Set([TREASURY_STATUS.COMPLETED, TREASURY_STATUS.PREFINANCED, TREASURY_STATUS.SETTLED]);
const iso = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
const addDays = (value, days) => { const date = new Date(`${iso(value)}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
const endOfMonth = value => { const date = new Date(`${iso(value)}T00:00:00Z`); return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))); };
const endOfYear = value => `${iso(value).slice(0, 4)}-12-31`;

function totals(rows) {
  return rows.reduce((out, row) => { out.income += row.type === 'income' ? row.amount : 0; out.expense += row.type === 'expense' ? row.amount : 0; out.net += row.signedAmount; out.count += 1; return out; }, { income: 0, expense: 0, net: 0, count: 0 });
}
function rounded(summary) { return Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, typeof value === 'number' ? Math.round((value + Number.EPSILON) * 100) / 100 : value])); }

export function createTreasuryViewModel(rows, accounts = [], asOf = new Date()) {
  const today = iso(asOf), treasury = buildTreasury(rows, { asOf });
  const open = treasury.items.filter(row => OPEN.has(row.status)), real = treasury.items.filter(row => REAL.has(row.status));
  const byStatus = Object.fromEntries(Object.values(TREASURY_STATUS).map(status => [status, rounded(totals(treasury.items.filter(row => row.status === status)))]));
  const horizonEnds = { week: addDays(today, 7), month: endOfMonth(today), days30: addDays(today, 30), year: endOfYear(today) };
  const horizons = Object.fromEntries(Object.entries(horizonEnds).map(([key, end]) => [key, { end, ...rounded(totals(open.filter(row => row.date <= end))) }]));
  const futureIncomes = open.filter(row => row.type === 'income' && row.date >= today), nextIncomeDate = futureIncomes[0]?.date || null;
  const nextIncomeRows = nextIncomeDate ? futureIncomes.filter(row => row.date === nextIncomeDate) : [];
  const dueBeforeIncome = nextIncomeDate ? open.filter(row => row.type === 'expense' && row.date <= nextIncomeDate) : open.filter(row => row.type === 'expense' && row.date <= horizonEnds.days30);
  const accountRows = accounts.map(account => {
    const accountReal = real.filter(row => row.accountId === account.id), registered = account.current_balance ?? account.balance ?? account.opening_balance;
    const confirmed = computeConfirmedBalance(account, real, asOf);
    return { id: account.id, name: account.name || 'Cuenta sin nombre', registeredBalance: registered == null ? null : Number(registered), confirmedBalance: confirmed.available ? confirmed.balance : null, balanceReason: confirmed.available ? null : confirmed.reason, realFlow: confirmed.available ? confirmed.flow : rounded(totals(accountReal)).net, movements: confirmed.available ? confirmed.movements : accountReal.length };
  });
  if (real.some(row => !row.accountId)) { const unassigned = real.filter(row => !row.accountId); accountRows.push({ id: null, name: 'Sin cuenta asignada', registeredBalance: null, realFlow: rounded(totals(unassigned)).net, movements: unassigned.length }); }
  return Object.freeze({ today, all: treasury.items, open, real, byStatus, horizons, nextIncomeDate, nextIncome: rounded(totals(nextIncomeRows)), dueBeforeIncome, dueBeforeIncomeTotals: rounded(totals(dueBeforeIncome)), accountRows });
}

export function legacyPendingTotals(rows, asOf = new Date()) { const vm = createTreasuryViewModel(rows, [], asOf); return rounded(totals(vm.open)); }
