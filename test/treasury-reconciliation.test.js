import test from 'node:test';
import assert from 'node:assert/strict';
import { computeConfirmedBalance, movementMatchScore, reconcileStatement, reconciliationSummary } from '../src/treasury/reconciliation.js';
import { parseStatementCsv } from '../src/treasury/statement-csv.js';

const movements = [
  { id: 'm1', date: '2026-09-15', concept: 'Mercadona', signedAmount: -42.15, accountId: 'bank', source: { invoice_number: 'T-100' } },
  { id: 'm2', date: '2026-09-17', concept: 'Nómina Empresa', signedAmount: 1200, accountId: 'bank', source: {} }
];
test('propone coincidencia por importe exacto, fecha y texto', () => { const row = { date: '2026-09-15', concept: 'Compra MERCADONA', signedAmount: -42.15 }; assert.ok(movementMatchScore(row, movements[0]) >= 80); assert.equal(reconcileStatement([row], movements)[0].candidate.id, 'm1'); });
test('no concilia importes diferentes', () => { assert.equal(movementMatchScore({ date: '2026-09-15', concept: 'Mercadona', signedAmount: -42.16 }, movements[0]), 0); });
test('marca ambiguo cuando dos candidatos son equivalentes', () => { const duplicate = { ...movements[0], id: 'm3' }; assert.equal(reconcileStatement([{ date: '2026-09-15', concept: 'Mercadona', signedAmount: -42.15 }], [movements[0], duplicate])[0].status, 'ambiguo'); });
test('un movimiento DOMUS no se propone dos veces', () => { const result = reconcileStatement([{ date: '2026-09-15', concept: 'Mercadona', signedAmount: -42.15 }, { date: '2026-09-15', concept: 'Mercadona', signedAmount: -42.15 }], [movements[0]]); assert.deepEqual(result.map(row => row.status), ['propuesto', 'sin_coincidencia']); });
test('calcula saldo solo desde un saldo inicial confirmado', () => { assert.equal(computeConfirmedBalance({ id: 'bank' }, movements, '2026-09-17').available, false); const result = computeConfirmedBalance({ id: 'bank', opening_balance: 500, opening_balance_date: '2026-09-14' }, movements, '2026-09-17'); assert.deepEqual({ balance: result.balance, flow: result.flow, movements: result.movements }, { balance: 1657.85, flow: 1157.85, movements: 2 }); });
test('resume el resultado sin confirmar conciliaciones', () => { const summary = reconciliationSummary(reconcileStatement([{ date: '2026-09-17', concept: 'Nomina', signedAmount: 1200 }, { date: '2026-09-01', concept: 'Otro', signedAmount: -9 }], movements)); assert.deepEqual(summary, { total: 2, propuesto: 1, revisar: 0, ambiguo: 0, sin_coincidencia: 1 }); });
test('importa CSV español con cargo y abono', () => { const rows = parseStatementCsv('Fecha;Concepto;Cargo;Abono;Referencia\n15/09/2026;Mercadona;42,15;;T-100\n17/09/2026;Nómina;;1.200,00;'); assert.deepEqual(rows.map(row => row.signedAmount), [-42.15, 1200]); assert.equal(rows[0].date, '2026-09-15'); });
test('rechaza CSV sin columnas mínimas', () => { assert.throws(() => parseStatementCsv('Uno;Dos\na;b'), /Se necesitan/); });
