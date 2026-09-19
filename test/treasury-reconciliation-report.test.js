import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconciliationReport, createStatementFingerprint, movementsForStatementAccount, reconciliationReportFileName, serializeReconciliationReport, sha256Hex } from '../src/treasury/reconciliation-report.js';

test('calcula la huella SHA-256 estándar del contenido', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('la clave de duplicado incluye cuenta y contenido', async () => {
  const first = await createStatementFingerprint('bank-a', 'Fecha;Importe\n01/01/2026;10');
  const same = await createStatementFingerprint('bank-a', 'Fecha;Importe\n01/01/2026;10');
  const otherAccount = await createStatementFingerprint('bank-b', 'Fecha;Importe\n01/01/2026;10');
  assert.equal(first.duplicateKey, same.duplicateKey);
  assert.notEqual(first.duplicateKey, otherAccount.duplicateKey);
  assert.equal(first.contentSha256.length, 64);
});

test('exige cuenta antes de crear la huella de importación', async () => {
  await assert.rejects(() => createStatementFingerprint('', 'contenido'), /Selecciona la cuenta/);
});

test('un extracto solo recibe candidatos de la cuenta seleccionada', () => {
  const rows = movementsForStatementAccount([{ id: 'a', accountId: 'bank-a' }, { id: 'b', accountId: 'bank-b' }, { id: 'none', accountId: null }], 'bank-a');
  assert.deepEqual(rows.map(row => row.id), ['a']);
});

test('genera un informe auditable sin marcarlo como persistido', () => {
  const session = { rows: [{ statement: { id: 'line-1', date: '2026-09-17', concept: 'Compra', reference: 'R1', signedAmount: -10 }, matchStatus: 'propuesto', score: 90, decision: 'confirmada', selectedMovementId: 'movement-1', candidates: [{ id: 'movement-1', concept: 'Compra DOMUS' }] }] };
  const report = buildReconciliationReport({ account: { id: 'bank', name: 'Banco' }, fileName: 'extracto.csv', fingerprint: { contentSha256: 'a'.repeat(64) }, session, generatedAt: '2026-09-17T12:00:00Z' });
  assert.equal(report.persisted, false);
  assert.deepEqual(report.summary, { pendiente: 0, confirmada: 1, descartada: 0 });
  assert.equal(report.rows[0].movementConcept, 'Compra DOMUS');
  assert.equal(JSON.parse(serializeReconciliationReport(report)).statement.contentSha256, 'a'.repeat(64));
});

test('normaliza el nombre descargable del informe', () => {
  assert.equal(reconciliationReportFileName('Extracto Septiembre 2026.csv'), 'Extracto-Septiembre-2026-conciliacion-domus.json');
});
