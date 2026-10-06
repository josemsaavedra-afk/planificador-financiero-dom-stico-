const freezeRows = rows => Object.freeze(rows.map(row => Object.freeze({ ...row, candidates: Object.freeze([...row.candidates]) })));

function candidateList(result) {
  const rows = [result.candidate, ...(result.alternatives || []).map(item => item.movement)].filter(Boolean);
  return rows.filter((movement, index) => rows.findIndex(item => item.id === movement.id) === index);
}

export function createReviewSession(results) {
  const rows = results.map(result => {
    const candidates = candidateList(result);
    return {
      statement: result.statement,
      matchStatus: result.status,
      score: result.score,
      candidates,
      selectedMovementId: result.status === 'propuesto' ? result.candidate?.id || null : null,
      decision: 'pendiente'
    };
  });
  return Object.freeze({ rows: freezeRows(rows) });
}

export function selectReviewCandidate(session, statementId, movementId) {
  const target = session.rows.find(row => row.statement.id === statementId);
  if (!target) throw new Error('Línea de extracto no encontrada');
  if (target.decision !== 'pendiente') throw new Error('La decisión ya está cerrada');
  if (movementId && !target.candidates.some(candidate => candidate.id === movementId)) throw new Error('El movimiento no pertenece a las propuestas de esta línea');
  const rows = session.rows.map(row => row.statement.id === statementId ? { ...row, selectedMovementId: movementId || null } : row);
  return Object.freeze({ rows: freezeRows(rows) });
}

export function decideReview(session, statementId, decision) {
  if (!['confirmada', 'descartada'].includes(decision)) throw new Error('Decisión de conciliación no válida');
  const target = session.rows.find(row => row.statement.id === statementId);
  if (!target) throw new Error('Línea de extracto no encontrada');
  if (target.decision !== 'pendiente') throw new Error('La decisión ya está cerrada');
  if (decision === 'confirmada' && !target.selectedMovementId) throw new Error('Selecciona un movimiento antes de confirmar');
  if (decision === 'confirmada' && session.rows.some(row => row.decision === 'confirmada' && row.selectedMovementId === target.selectedMovementId)) throw new Error('Ese movimiento DOMUS ya está confirmado para otra línea');
  const rows = session.rows.map(row => row.statement.id === statementId ? { ...row, decision } : row);
  return Object.freeze({ rows: freezeRows(rows) });
}

export function reviewSummary(session) {
  return session.rows.reduce((summary, row) => {
    summary.total += 1;
    summary[row.decision] += 1;
    return summary;
  }, { total: 0, pendiente: 0, confirmada: 0, descartada: 0 });
}

export function confirmedReviewDraft(session) {
  return Object.freeze(session.rows.filter(row => row.decision === 'confirmada').map(row => Object.freeze({
    statementId: row.statement.id,
    movementId: row.selectedMovementId,
    statementDate: row.statement.date,
    signedAmount: row.statement.signedAmount,
    source: 'revision_local_no_persistida'
  })));
}
