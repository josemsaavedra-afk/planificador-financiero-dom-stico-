import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckpointDraft, checkpointDecimal } from '../src/treasury/checkpoint-draft.js';

const householdId = '11111111-1111-4111-8111-111111111111';
const account = { id: '22222222-2222-4222-8222-222222222222', household_id: householdId };
const input = { householdId, account, amount: '-42.15', date: '2026-09-18', asOf: '2026-09-19', generatedAt: '2026-09-19T12:00:00Z' };

test('genera un borrador manual exacto sin identidad de auditoría inventada', () => {
  const before = structuredClone(input);
  const draft = buildCheckpointDraft(input);
  assert.deepEqual(draft.proposal, { household_id: householdId, account_id: account.id, balance_date: input.date,
    balance: '-42.15', currency: 'EUR', source: 'manual', note: null });
  assert.equal(draft.persisted, false);
  assert.equal(draft.requiresAuthorization, true);
  assert.equal(draft.generatedAt, '2026-09-19T12:00:00.000Z');
  assert.equal(draft.target, 'account_balance_checkpoints');
  assert.deepEqual(input, before);
  assert.ok(Object.isFrozen(draft.proposal));
  assert.equal(JSON.parse(JSON.stringify(draft)).proposal.balance, '-42.15');
});

test('conserva céntimos, cero y límites numeric(14,2) sin redondear', () => {
  for (const [value, expected] of [[0, '0.00'], ['-0.00', '0.00'], ['001.2', '1.20'], ['0.01', '0.01'],
    ['999999999999.99', '999999999999.99'], ['-999999999999.99', '-999999999999.99']]) {
    assert.equal(checkpointDecimal(value), expected);
  }
});

test('rechaza importes ambiguos, precisión excesiva y desbordamientos', () => {
  for (const value of ['', ' ', null, undefined, true, [], {}, NaN, Infinity, '1e2', '0x10', '1,23', '1.005', '-1.005', '1000000000000']) {
    assert.throws(() => buildCheckpointDraft({ ...input, amount: value }), /Saldo no válido/);
  }
});

test('rechaza hogares ausentes, ids inválidos y cuentas de otro hogar', () => {
  for (const patch of [{ householdId: '' }, { householdId: 'invalid' }, { account: null },
    { account: { ...account, household_id: undefined } }, { account: { ...account, household_id: account.id } }]) {
    assert.throws(() => buildCheckpointDraft({ ...input, ...patch }), /Hogar|Cuenta|hogar/);
  }
});

test('normaliza UUID sin cambiar su identidad', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const draft = buildCheckpointDraft({ ...input, householdId: id.toUpperCase(), account: { ...account, household_id: id } });
  assert.equal(draft.proposal.household_id, id);
});

test('exige fechas reales completas y no futuras, incluido el corte', () => {
  for (const date of ['2026-02-29', '2026-02-31', '2026-13-01', '0000-01-01', '2026-09-20', '2026-09-18suffix', '', null]) {
    assert.throws(() => buildCheckpointDraft({ ...input, date }), /Fecha|futura/);
  }
  assert.throws(() => buildCheckpointDraft({ ...input, asOf: 'incorrecta' }), /Fecha/);
  assert.throws(() => buildCheckpointDraft({ ...input, generatedAt: 'incorrecta' }), /generación/);
  assert.equal(buildCheckpointDraft({ ...input, date: '2024-02-29' }).proposal.balance_date, '2024-02-29');
});

test('solo incluye campos permitidos, limpia la nota y no acepta auditoría del llamante', () => {
  const draft = buildCheckpointDraft({ ...input, note: '  Revisar saldo  ', source: 'bank_statement', created_by: 'spoofed', persisted: true });
  assert.equal(draft.proposal.note, 'Revisar saldo');
  assert.equal(draft.proposal.source, 'manual');
  assert.equal(draft.proposal.created_by, undefined);
  assert.equal(draft.persisted, false);
  assert.throws(() => buildCheckpointDraft({ ...input, note: {} }), /Nota/);
});
