import test, { before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

// No URL, credentials, persistent data directory or external database accepted.
const db = new PGlite();
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const up = read('../database/proposals/alpha12_treasury_persistence_up.sql');
const down = read('../database/proposals/alpha12_treasury_persistence_down.sql');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tables = ['account_balance_checkpoints', 'bank_statement_imports', 'bank_statement_lines', 'treasury_reconciliations'];

async function asUser(n) {
  await db.exec('set local role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [n == null ? '' : id(n)]);
}
async function insert(table, row) {
  const columns = Object.keys(row); // All table/column names are test constants.
  return db.query(`insert into public.${table} (${columns.join(',')}) values (${columns.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, Object.values(row));
}
const checkpoint = (patch = {}) => insert(tables[0], { household_id: id(11), account_id: id(101), balance_date: '2026-09-19', balance: '123.45', source: 'manual', ...patch });
const bankImport = (patch = {}) => insert(tables[1], { household_id: id(11), account_id: id(101), file_name: 'ficticio.csv', content_sha256: 'c'.repeat(64), line_count: 1, ...patch });
const line = (patch = {}) => insert(tables[2], { import_id: id(301), line_ordinal: 3, transaction_date: '2026-09-19', concept: 'Ficticio', signed_amount: -10, content_sha256: 'c'.repeat(64), ...patch });
const reconciliation = (patch = {}) => insert(tables[3], { household_id: id(11), statement_line_id: id(401), movement_series_id: id(201), occurrence_date: '2026-09-19', ...patch });

async function rejected(action, code) {
  await db.exec('savepoint expected_rejection');
  try {
    await assert.rejects(action, error => {
      assert.ok([code].flat().includes(error.code), `Expected SQLSTATE ${code}, received ${error.code}: ${error.message}`);
      return true;
    });
  }
  finally { await db.exec('rollback to savepoint expected_rejection; release savepoint expected_rejection'); }
}

before(async () => {
  await db.exec(read('../database/tests/treasury_fixture.sql'));
  await db.exec(up); // Execute the exact reviewed proposal, including its policies and grants.
  for (const [household, account, actor, importId, lineId, hash] of [[11, 101, 1, 301, 401, 'a'], [12, 102, 2, 302, 402, 'b']]) {
    await checkpoint({ household_id: id(household), account_id: id(account), balance_date: '2026-09-18', created_by: id(actor) });
    await bankImport({ id: id(importId), household_id: id(household), account_id: id(account), imported_by: id(actor), content_sha256: hash.repeat(64) });
    await line({ id: id(lineId), import_id: id(importId), line_ordinal: 1, content_sha256: hash.repeat(64) });
  }
  await line({ id: id(403), line_ordinal: 2, content_sha256: 'd'.repeat(64) });
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('begin'); await asUser(1); });
afterEach(async () => { await db.exec('rollback'); });

test('RLS se ejecuta con rol sin superusuario, sin BYPASSRLS y sin propiedad de tablas', async () => {
  const { rows } = await db.query('select current_user, rolsuper, rolbypassrls from pg_roles where rolname = current_user');
  assert.deepEqual(rows[0], { current_user: 'authenticated', rolsuper: false, rolbypassrls: false });
  const meta = await db.query("select relrowsecurity, pg_get_userbyid(relowner) as owner from pg_class where relname = any($1)", [tables]);
  assert.equal(meta.rows.length, 4);
  assert.ok(meta.rows.every(row => row.relrowsecurity && row.owner !== 'authenticated'));
});

test('permite saldo del hogar propio, precisión decimal y autor de sesión por defecto', async () => {
  const { rows } = await checkpoint();
  assert.equal(rows[0].created_by, id(1));
  assert.equal(rows[0].balance, '123.45');
  assert.equal(rows[0].currency, 'EUR');
});

test('bloquea lecturas de los cuatro recursos de otro hogar', async () => {
  await reconciliation();
  await asUser(2);
  await reconciliation({ household_id: id(12), statement_line_id: id(402), movement_series_id: id(202) });
  for (const user of [1, 2, 3, 5]) {
    await asUser(user);
    for (const table of tables) {
      const { rows } = await db.query(`select * from public.${table}`);
      if (user === 5) assert.equal(rows.length, 0);
      else if (user === 3) assert.ok(rows.length >= 2);
      else if (table === 'bank_statement_lines') assert.ok(rows.length > 0 && rows.every(row => row.import_id === id(user === 1 ? 301 : 302)));
      else assert.ok(rows.length > 0 && rows.every(row => row.household_id === id(user === 1 ? 11 : 12)));
    }
  }
});

test('impide escrituras en hogar ajeno y suplantación del autor', async () => {
  await rejected(() => checkpoint({ household_id: id(12), account_id: id(102) }), '42501');
  await rejected(() => checkpoint({ created_by: id(2) }), '42501');
  await rejected(() => bankImport({ imported_by: id(2) }), '42501');
  await rejected(() => reconciliation({ confirmed_by: id(2) }), '42501');
});

test('miembro de dos hogares no mezcla cuenta y hogar en saldos ni importaciones', async () => {
  await asUser(3);
  await rejected(() => checkpoint({ account_id: id(102) }), '42501');
  await rejected(() => checkpoint({ household_id: id(12) }), '42501');
  await rejected(() => bankImport({ account_id: id(102) }), '42501');
  await rejected(() => bankImport({ household_id: id(12) }), '42501');
});

test('solo el importador puede añadir líneas; miembros del mismo hogar pueden leerlas', async () => {
  await line();
  await rejected(() => line({ import_id: id(302) }), '42501');
  await asUser(4);
  assert.equal((await db.query('select * from public.bank_statement_lines')).rows.length, 3);
  await rejected(() => line({ line_ordinal: 4 }), '42501');
});

test('rechaza identidades nulas y usuarios sin hogar, y anon carece de permisos', async () => {
  for (const user of [null, 5]) {
    await asUser(user);
    await rejected(() => checkpoint(), '42501');
    await rejected(() => bankImport(), '42501');
    await rejected(() => line(), '42501');
    await rejected(() => reconciliation(), '42501');
  }
  await db.exec('set local role anon');
  for (const table of tables) await rejected(() => db.query(`select * from public.${table}`), '42501');
});

test('saldo, importación y línea son append-only para authenticated', async () => {
  for (const table of tables.slice(0, 3)) {
    await rejected(() => db.query(`delete from public.${table}`), '42501');
    await rejected(() => db.query(`update public.${table} set id = id`), '42501');
  }
  await rejected(() => db.query('delete from public.treasury_reconciliations'), '42501');
});

test('detecta duplicados de saldo, importación, ordinal y huella de línea', async () => {
  await checkpoint();
  await rejected(() => checkpoint(), '23505');
  await rejected(() => bankImport({ content_sha256: 'a'.repeat(64) }), '23505');
  await rejected(() => line({ line_ordinal: 1 }), '23505');
  await rejected(() => line({ content_sha256: 'a'.repeat(64) }), '23505');
});

test('conciliación válida exige misma cuenta, hogar y ocurrencia existente', async () => {
  const { rows } = await reconciliation();
  assert.equal(rows[0].confirmed_by, id(1));
  assert.equal(rows[0].status, 'confirmed');
  await rejected(() => reconciliation({ statement_line_id: id(403), movement_series_id: id(203) }), '42501');
  await rejected(() => reconciliation({ statement_line_id: id(403), occurrence_date: '2026-09-21' }), '23503');
});

test('miembro de dos hogares no reasigna una conciliación a otro hogar', async () => {
  await asUser(3);
  await rejected(() => reconciliation({ household_id: id(12) }), '42501');
  await rejected(() => reconciliation({ statement_line_id: id(402), movement_series_id: id(202) }), '42501');
  await rejected(() => reconciliation({ statement_line_id: id(402) }), '42501');
});

test('no permite dos confirmaciones activas para línea u ocurrencia', async () => {
  await reconciliation();
  await rejected(() => reconciliation({ occurrence_date: '2026-09-20' }), '23505');
  await rejected(() => reconciliation({ statement_line_id: id(403) }), '23505');
});

test('revoca con autor y motivo, conserva historial y permite nueva confirmación', async () => {
  const first = (await reconciliation()).rows[0];
  await db.query("update public.treasury_reconciliations set status='revoked', revoked_by=auth.uid(), revoked_at=now(), revocation_reason='Corrección ficticia' where id=$1", [first.id]);
  const revoked = (await db.query('select * from public.treasury_reconciliations where id=$1', [first.id])).rows[0];
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revoked_by, id(1));
  assert.equal(revoked.confirmed_by, first.confirmed_by);
  const second = (await reconciliation()).rows[0];
  assert.notEqual(second.id, first.id);
  const result = await db.query("update public.treasury_reconciliations set revocation_reason='Reescritura' where id=$1 returning id", [first.id]);
  assert.equal(result.rows.length, 0);
});

test('revocar no permite alterar identidad, puntuación ni autor de confirmación', async () => {
  const row = (await reconciliation()).rows[0];
  for (const change of ["id=gen_random_uuid()", `household_id='${id(12)}'`, `statement_line_id='${id(403)}'`,
    `movement_series_id='${id(203)}'`, "occurrence_date='2026-09-20'", `confirmed_by='${id(2)}'`,
    "confirmed_at=confirmed_at+interval '1 second'", 'match_score=42']) {
    await rejected(() => db.query(`update public.treasury_reconciliations set status='revoked', revoked_by=auth.uid(), revoked_at=now(), revocation_reason='Prueba', ${change} where id=$1`, [row.id]), 'P0001');
  }
});

test('rechaza revocación con autor ajeno o motivo vacío', async () => {
  await reconciliation();
  await rejected(() => db.query(`update public.treasury_reconciliations set status='revoked', revoked_by='${id(2)}', revoked_at=now(), revocation_reason='Prueba'`), '42501');
  await rejected(() => db.query("update public.treasury_reconciliations set status='revoked', revoked_by=auth.uid(), revoked_at=now(), revocation_reason=' '"), '42501');
});

test('revocaciones de otro hogar no encuentran filas modificables', async () => {
  await reconciliation();
  await asUser(2);
  const { rows } = await db.query("update public.treasury_reconciliations set status='revoked', revoked_by=auth.uid(), revoked_at=now(), revocation_reason='Cruce' returning id");
  assert.equal(rows.length, 0);
});

test('las referencias impiden borrar historial por cascada incluso al propietario', async () => {
  await reconciliation();
  await db.exec('reset role');
  for (const [table, n] of [['accounts', 101], ['bank_statement_imports', 301], ['bank_statement_lines', 401], ['movement_series', 201]]) {
    await rejected(() => db.query(`delete from public.${table} where id=$1`, [id(n)]), ['23503', '23001']);
    assert.equal((await db.query(`select id from public.${table} where id=$1`, [id(n)])).rows.length, 1);
  }
});

test('regresión: las correlaciones antiguas de saldo e importación admiten cruces con membresía doble', async () => {
  await db.exec('reset role');
  await db.exec(`alter policy account_balance_checkpoints_insert on public.account_balance_checkpoints
    with check (created_by=auth.uid() and private.is_household_member(household_id)
      and exists (select 1 from public.accounts a where a.id=account_id and a.household_id=household_id))`);
  await asUser(3);
  const { rows } = await checkpoint({ account_id: id(102) });
  assert.equal(rows[0].household_id, id(11));
  await db.exec('reset role');
  await db.exec(`alter policy bank_statement_imports_insert on public.bank_statement_imports
    with check (imported_by=auth.uid() and private.is_household_member(household_id)
      and exists (select 1 from public.accounts a where a.id=account_id and a.household_id=household_id))`);
  await asUser(3);
  assert.equal((await bankImport({ account_id: id(102) })).rows[0].household_id, id(11));
  // Transaction rollback restores the corrected policy after demonstrating the bug.
});

test('aplica las restricciones de moneda, origen, precisión, huella e intervalo', async () => {
  await rejected(() => checkpoint({ currency: 'USD' }), '23514');
  await rejected(() => checkpoint({ source: 'automatic' }), '23514');
  await rejected(() => checkpoint({ balance: '1000000000000.00' }), '22003');
  await rejected(() => bankImport({ content_sha256: 'invalid' }), '23514');
  await rejected(() => bankImport({ line_count: -1 }), '23514');
  await rejected(() => bankImport({ period_start: '2026-09-20', period_end: '2026-09-19' }), '23514');
  await rejected(() => line({ line_ordinal: 0 }), '23514');
  await rejected(() => line({ signed_amount: 0 }), '23514');
  await rejected(() => reconciliation({ match_score: 101 }), '23514');
  await rejected(() => reconciliation({ status: 'revoked', revoked_by: id(1), revoked_at: '2026-09-19T12:00:00Z', revocation_reason: 'Prueba' }), '42501');
});

test('un segundo miembro del mismo hogar puede confirmar y revocar sin suplantar al primero', async () => {
  await asUser(4);
  const row = (await reconciliation()).rows[0];
  assert.equal(row.confirmed_by, id(4));
  await asUser(1);
  await db.query("update public.treasury_reconciliations set status='revoked', revoked_by=auth.uid(), revoked_at=now(), revocation_reason='Revisión compartida' where id=$1", [row.id]);
  const revoked = (await db.query('select * from public.treasury_reconciliations where id=$1', [row.id])).rows[0];
  assert.equal(revoked.confirmed_by, id(4));
  assert.equal(revoked.revoked_by, id(1));
});

test('reversión y reaplicación solo en otra instancia efímera, sin alterar tablas base', async () => {
  const scratch = new PGlite();
  try {
    await scratch.exec(read('../database/tests/treasury_fixture.sql'));
    await scratch.exec(up);
    await scratch.exec(down);
    assert.equal((await scratch.query("select to_regclass('public.account_balance_checkpoints') as name")).rows[0].name, null);
    assert.equal((await scratch.query('select count(*)::int as n from public.accounts')).rows[0].n, 3);
    await scratch.exec(up);
    assert.equal((await scratch.query('select count(*)::int as n from public.account_balance_checkpoints')).rows[0].n, 0);
  } finally { await scratch.close(); }
});
