const textEncoder = new TextEncoder();
const clean = value => String(value ?? '').trim();

export async function sha256Hex(text, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Este navegador no permite calcular la huella SHA-256');
  const digest = await cryptoApi.subtle.digest('SHA-256', textEncoder.encode(String(text ?? '')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createStatementFingerprint(accountId, text, cryptoApi = globalThis.crypto) {
  if (!clean(accountId)) throw new Error('Selecciona la cuenta del extracto');
  const contentSha256 = await sha256Hex(text, cryptoApi);
  return Object.freeze({ accountId: clean(accountId), contentSha256, duplicateKey: `${clean(accountId)}:${contentSha256}` });
}

export function movementsForStatementAccount(movements, accountId) {
  if (!clean(accountId)) throw new Error('Selecciona la cuenta del extracto');
  return Object.freeze((movements || []).filter(movement => movement.accountId === accountId));
}

export function buildReconciliationReport({ account, fileName, fingerprint, session, generatedAt = new Date() }) {
  if (!account?.id || !fingerprint?.contentSha256 || !session?.rows) throw new Error('Faltan datos para generar el informe');
  const summary = session.rows.reduce((out, row) => { out[row.decision] += 1; return out; }, { pendiente: 0, confirmada: 0, descartada: 0 });
  return Object.freeze({
    format: 'domus-treasury-reconciliation',
    version: 1,
    generatedAt: new Date(generatedAt).toISOString(),
    persisted: false,
    account: Object.freeze({ id: account.id, name: account.name || 'Cuenta sin nombre' }),
    statement: Object.freeze({ fileName: clean(fileName) || 'extracto.csv', contentSha256: fingerprint.contentSha256, lines: session.rows.length }),
    summary: Object.freeze(summary),
    rows: Object.freeze(session.rows.map(row => Object.freeze({
      statementId: row.statement.id,
      date: row.statement.date,
      concept: row.statement.concept,
      reference: row.statement.reference || null,
      signedAmount: Number(row.statement.signedAmount),
      matchStatus: row.matchStatus,
      score: row.score,
      decision: row.decision,
      movementId: row.selectedMovementId || null,
      movementConcept: row.candidates.find(candidate => candidate.id === row.selectedMovementId)?.concept || null
    })))
  });
}

export function serializeReconciliationReport(report) { return `${JSON.stringify(report, null, 2)}\n`; }

export function reconciliationReportFileName(fileName) {
  const base = clean(fileName).replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'extracto';
  return `${base}-conciliacion-domus.json`;
}
