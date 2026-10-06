import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreasuryViewModel, legacyPendingTotals } from '../src/treasury/view-model.js';

const AS_OF = '2026-09-17';
const rows = [
  { id: 'late', type: 'expense', concept: 'Vencido', amount: 30, occurrence_date: '2026-09-10', status: 'pending', account_id: 'a' },
  { id: 'today', type: 'expense', concept: 'Hoy', amount: 20, occurrence_date: AS_OF, status: 'pending', account_id: 'a' },
  { id: 'future', type: 'income', concept: 'Nómina', amount: 1000, occurrence_date: '2026-09-20', status: 'pending', account_id: 'a' },
  { id: 'paid', type: 'expense', concept: 'Pagado', amount: 40, occurrence_date: '2026-09-12', status: 'done', actual_date: '2026-09-12', account_id: 'a' },
  { id: 'pref', type: 'income', concept: 'Adelanto', amount: 200, occurrence_date: '2026-09-30', status: 'done', actual_date: AS_OF, prefinanced: true, prefinanced_fee: 9.8, prefinanced_net: 190.2, account_id: 'a' }
];
test('separa flujos reales y previsiones sin doble cómputo', () => { const vm = createTreasuryViewModel(rows, [{ id: 'a', name: 'Banco' }], AS_OF); assert.deepEqual(vm.open.map(row => row.id), ['late', 'today', 'future']); assert.deepEqual(vm.real.map(row => row.id), ['paid', 'pref']); assert.equal(vm.accountRows[0].realFlow, 150.2); });
test('el próximo cobro incluye vencidos y pagos hasta su fecha', () => { const vm = createTreasuryViewModel(rows, [], AS_OF); assert.equal(vm.nextIncomeDate, '2026-09-20'); assert.equal(vm.nextIncome.income, 1000); assert.equal(vm.dueBeforeIncomeTotals.expense, 50); });
test('los horizontes son acumulados e incluyen vencidos abiertos', () => { const vm = createTreasuryViewModel(rows, [], AS_OF); assert.equal(vm.horizons.week.expense, 50); assert.equal(vm.horizons.week.income, 1000); assert.equal(vm.horizons.year.net, 950); });
test('regresión: pendiente 2.5.8 equivale a estados abiertos 3.0', () => { const old = rows.filter(row => row.status === 'pending').reduce((out, row) => { out[row.type] += row.amount; return out; }, { income: 0, expense: 0 }); const compatible = legacyPendingTotals(rows, AS_OF); assert.equal(compatible.income, old.income); assert.equal(compatible.expense, old.expense); });
