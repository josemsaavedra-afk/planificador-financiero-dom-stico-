import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TREASURY_STATUS, buildTreasury, classifyTreasuryStatus,
  normalizeTreasuryItem, projectAccountBalances, treasuryHorizon
} from '../src/treasury/engine.js';
import { buildLegacyTreasury } from '../src/treasury/legacy-adapter.js';

const AS_OF = '2026-09-17';
const movement = (overrides = {}) => ({
  id: crypto.randomUUID(), type: 'expense', concept: 'Prueba', amount: 100,
  occurrence_date: AS_OF, status: 'pending', ...overrides
});

test('clasifica previsto, pendiente y vencido por fecha efectiva', () => {
  assert.equal(classifyTreasuryStatus(movement({ occurrence_date: '2026-09-18' }), AS_OF), TREASURY_STATUS.FORECAST);
  assert.equal(classifyTreasuryStatus(movement(), AS_OF), TREASURY_STATUS.PENDING);
  assert.equal(classifyTreasuryStatus(movement({ occurrence_date: '2026-09-16' }), AS_OF), TREASURY_STATUS.OVERDUE);
});

test('la fecha real y los estados terminales prevalecen sobre previsiones', () => {
  assert.equal(classifyTreasuryStatus(movement({ actual_date: '2026-09-15' }), AS_OF), TREASURY_STATUS.COMPLETED);
  assert.equal(classifyTreasuryStatus(movement({ status: 'settled' }), AS_OF), TREASURY_STATUS.SETTLED);
  assert.equal(classifyTreasuryStatus(movement({ status: 'cancelled' }), AS_OF), TREASURY_STATUS.CANCELLED);
});

test('una reprogramación conserva la fecha original y usa la nueva fecha', () => {
  const item = normalizeTreasuryItem(movement({ occurrence_date: '2026-09-10', rescheduled_date: '2026-09-24' }), AS_OF);
  assert.equal(item.status, TREASURY_STATUS.RESCHEDULED);
  assert.equal(item.originalDate, '2026-09-10');
  assert.equal(item.date, '2026-09-24');
});

test('la prefinanciación computa el neto sin sustituir el bruto', () => {
  const item = normalizeTreasuryItem(movement({ type: 'income', amount: 280, prefinanced: true, prefinanced_at: AS_OF, prefinanced_fee: 13.72 }), AS_OF);
  assert.equal(item.status, TREASURY_STATUS.PREFINANCED);
  assert.equal(item.gross, 280);
  assert.equal(item.fee, 13.72);
  assert.equal(item.amount, 266.28);
});

test('calcula totales sin mezclar cancelados', () => {
  const result = buildTreasury([
    movement({ id: 'i', type: 'income', amount: 1000 }),
    movement({ id: 'e', amount: 300 }),
    movement({ id: 'c', amount: 999, status: 'cancelled' })
  ], { asOf: AS_OF });
  assert.deepEqual({ income: result.totals.income, expense: result.totals.expense, net: result.totals.net }, { income: 1000, expense: 300, net: 700 });
});

test('proyecta saldo por cuenta en orden cronológico', () => {
  const result = projectAccountBalances([
    movement({ id: 'e', account_id: 'bank', amount: 25, occurrence_date: '2026-09-18' }),
    movement({ id: 'i', account_id: 'bank', type: 'income', amount: 100, occurrence_date: '2026-09-17' })
  ], [{ id: 'bank', opening_balance: 50 }], { asOf: AS_OF });
  assert.deepEqual(result.timeline.map(x => x.balance), [150, 125]);
  assert.equal(result.balances.bank, 125);
});

test('el horizonte incluye vencidos pendientes y excluye realizados', () => {
  const result = treasuryHorizon([
    movement({ id: 'late', occurrence_date: '2026-09-01' }),
    movement({ id: 'soon', occurrence_date: '2026-09-20' }),
    movement({ id: 'far', occurrence_date: '2026-10-20' }),
    movement({ id: 'done', occurrence_date: '2026-09-18', status: 'done' })
  ], 7, AS_OF);
  assert.deepEqual(result.items.map(x => x.id), ['late', 'soon']);
});

test('el adaptador mantiene compatibilidad con ocurrencias 2.5.8', () => {
  const result = buildLegacyTreasury([{ series_id: 's1', type: 'expense', concept: 'Luz', amount: 80, occurrence_date: '2026-09-16', status: 'pending' }], { asOf: AS_OF });
  assert.equal(result.items[0].id, 's1|2026-09-16');
  assert.equal(result.items[0].status, TREASURY_STATUS.OVERDUE);
});

test('rechaza fechas e importes inválidos para no contaminar cálculos', () => {
  assert.throws(() => normalizeTreasuryItem(movement({ amount: 'x' }), AS_OF), /numérico/);
  assert.throws(() => normalizeTreasuryItem(movement({ occurrence_date: '17-09-2026' }), AS_OF), /ISO válida/);
});
