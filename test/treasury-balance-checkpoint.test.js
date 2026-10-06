import test from 'node:test';
import assert from 'node:assert/strict';
import { accountWithLocalCheckpoint, createLocalCheckpoint, validateAccountReconciliation } from '../src/treasury/balance-checkpoint.js';

const AS_OF = '2026-09-17';
const account = { id: 'bank', name: 'Banco' };
const movements = [
  { id: 'old', accountId: 'bank', date: '2026-09-10', signedAmount: 500 },
  { id: 'expense', accountId: 'bank', date: '2026-09-15', signedAmount: -42.15 },
  { id: 'income', accountId: 'bank', date: '2026-09-17', signedAmount: 1200 },
  { id: 'other', accountId: 'cash', date: '2026-09-17', signedAmount: 50 }
];

test('crea un saldo inicial local fechado sin modificar la cuenta', () => {
  const checkpoint = createLocalCheckpoint({ accountId: 'bank', amount: '500.10', date: '2026-09-14' }, AS_OF);
  const enriched = accountWithLocalCheckpoint(account, checkpoint);
  assert.equal(account.opening_balance, undefined);
  assert.deepEqual({ amount: checkpoint.amount, balance: enriched.opening_balance, date: enriched.opening_balance_date }, { amount: 500.1, balance: 500.1, date: '2026-09-14' });
});

test('rechaza importes inválidos y fechas futuras', () => {
  assert.throws(() => createLocalCheckpoint({ accountId: 'bank', amount: '', date: '2026-09-14' }, AS_OF), /importe válido/);
  assert.throws(() => createLocalCheckpoint({ accountId: 'bank', amount: 'x', date: '2026-09-14' }, AS_OF), /importe válido/);
  assert.throws(() => createLocalCheckpoint({ accountId: 'bank', amount: 5, date: '2026-02-31' }, AS_OF), /fecha.*válida/);
  assert.throws(() => createLocalCheckpoint({ accountId: 'bank', amount: 5, date: '2026-09-18' }, AS_OF), /fecha futura/);
});

test('cuadra saldo inicial, flujo real y saldo bancario final', () => {
  const checkpoint = createLocalCheckpoint({ accountId: 'bank', amount: 500, date: '2026-09-14' }, AS_OF);
  const result = validateAccountReconciliation({ account, checkpoint, realMovements: movements, bankBalance: 1657.85, bankBalanceDate: AS_OF }, AS_OF);
  assert.deepEqual({ realFlow: result.realFlow, calculated: result.calculatedBalance, difference: result.difference, balanced: result.balanced, movements: result.movements }, { realFlow: 1157.85, calculated: 1657.85, difference: 0, balanced: true, movements: 2 });
});

test('muestra el descuadre sin alterar ni compensar movimientos', () => {
  const checkpoint = createLocalCheckpoint({ accountId: 'bank', amount: 500, date: '2026-09-14' }, AS_OF);
  const result = validateAccountReconciliation({ account, checkpoint, realMovements: movements, bankBalance: 1600, bankBalanceDate: AS_OF }, AS_OF);
  assert.equal(result.difference, -57.85);
  assert.equal(result.balanced, false);
  assert.equal(movements.length, 4);
});

test('rechaza un saldo final anterior al checkpoint', () => {
  const checkpoint = createLocalCheckpoint({ accountId: 'bank', amount: 500, date: '2026-09-14' }, AS_OF);
  assert.throws(() => validateAccountReconciliation({ account, checkpoint, realMovements: movements, bankBalance: 500, bankBalanceDate: '2026-09-13' }, AS_OF), /no puede ser anterior/);
});
