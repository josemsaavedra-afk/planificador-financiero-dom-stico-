import { buildTreasury } from './engine.js';

export function adaptLegacyOccurrences(occurrences) {
  return occurrences.map(row => ({
    ...row,
    id: row.id || `${row.series_id}|${row.occurrence_date}`,
    expected_treasury_date: row.expected_treasury_date || row.occurrence_date || row.start_date,
    amount: row.amount_override ?? row.amount,
    status: row.status || 'pending'
  }));
}

export function buildLegacyTreasury(occurrences, options = {}) {
  return buildTreasury(adaptLegacyOccurrences(occurrences), options);
}
