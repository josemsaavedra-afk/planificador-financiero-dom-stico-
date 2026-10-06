import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedReviewDraft, createReviewSession, decideReview, reviewSummary, selectReviewCandidate } from '../src/treasury/reconciliation-review.js';

const movementA = { id: 'movement-a', concept: 'Compra A' };
const movementB = { id: 'movement-b', concept: 'Compra B' };
const results = [
  { statement: { id: 'line-1', date: '2026-09-15', signedAmount: -10 }, status: 'propuesto', score: 90, candidate: movementA, alternatives: [{ movement: movementB, score: 70 }] },
  { statement: { id: 'line-2', date: '2026-09-16', signedAmount: -10 }, status: 'ambiguo', score: 78, candidate: movementA, alternatives: [{ movement: movementB, score: 76 }] },
  { statement: { id: 'line-3', date: '2026-09-17', signedAmount: -5 }, status: 'sin_coincidencia', score: 0, candidate: null, alternatives: [] }
];

test('solo preselecciona coincidencias propuestas con confianza suficiente', () => {
  const session = createReviewSession(results);
  assert.equal(session.rows[0].selectedMovementId, 'movement-a');
  assert.equal(session.rows[1].selectedMovementId, null);
  assert.equal(session.rows[2].selectedMovementId, null);
});

test('una coincidencia ambigua exige selección manual antes de confirmar', () => {
  let session = createReviewSession(results);
  assert.throws(() => decideReview(session, 'line-2', 'confirmada'), /Selecciona/);
  session = selectReviewCandidate(session, 'line-2', 'movement-b');
  session = decideReview(session, 'line-2', 'confirmada');
  assert.equal(session.rows[1].decision, 'confirmada');
});

test('impide confirmar un movimiento DOMUS para dos líneas', () => {
  let session = createReviewSession(results);
  session = decideReview(session, 'line-1', 'confirmada');
  session = selectReviewCandidate(session, 'line-2', 'movement-a');
  assert.throws(() => decideReview(session, 'line-2', 'confirmada'), /ya está confirmado/);
});

test('una decisión cerrada no se puede alterar accidentalmente', () => {
  const session = decideReview(createReviewSession(results), 'line-1', 'descartada');
  assert.throws(() => selectReviewCandidate(session, 'line-1', 'movement-b'), /ya está cerrada/);
  assert.throws(() => decideReview(session, 'line-1', 'confirmada'), /ya está cerrada/);
});

test('el borrador contiene solo confirmaciones locales y trazables', () => {
  const session = decideReview(createReviewSession(results), 'line-1', 'confirmada');
  assert.deepEqual(confirmedReviewDraft(session), [{ statementId: 'line-1', movementId: 'movement-a', statementDate: '2026-09-15', signedAmount: -10, source: 'revision_local_no_persistida' }]);
  assert.deepEqual(reviewSummary(session), { total: 3, pendiente: 2, confirmada: 1, descartada: 0 });
});
