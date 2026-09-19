import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Minimal DOM port for exercising real event handlers without a browser dependency.
class Element {
  constructor() { this.nodes = new Map(); this.value = ''; this.dataset = {}; this.classList = { add() {}, remove() {} }; }
  querySelector(selector) {
    if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
    return this.nodes.get(selector);
  }
  querySelectorAll(selector) {
    if (selector === '[data-balance-account]') return this.boxes || [];
    return this.groups?.[selector] || [];
  }
  set innerHTML(value) {
    this.html = value;
    this.nodes.clear();
    this.groups = {};
    for (const [attribute, key] of [['data-review-confirm','reviewConfirm'],['data-review-discard','reviewDiscard'],['data-review-select','reviewSelect']]) {
      this.groups[`[${attribute}]`] = [...value.matchAll(new RegExp(attribute + '="([^"]+)"', 'g'))].map(match => {
        const element = new Element(); element.dataset[key] = match[1]; return element;
      });
    }
    this.boxes = [...value.matchAll(/data-balance-account="([^"]+)"/g)].map(match => {
      const box = new Element(); box.dataset.balanceAccount = match[1]; return box;
    });
  }
  get innerHTML() { return this.html || ''; }
  replaceChildren() { this.innerHTML = ''; }
  setAttribute() {}
  closest() { return { parentElement: { insertBefore(element) { select = element; } } }; }
  remove() {}
  click() { downloadedName = this.download; }
}
let root, select, downloadedName, blob;
globalThis.document = { getElementById: () => root, createElement: () => new Element(), body: { appendChild() {} } };
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class {};
const { renderTreasury3, resetTreasury3 } = await import('../src/treasury/ui.js');
const householdId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const snapshot = { householdId, userId: 'user-a', asOf: '2026-09-19', rows: [], accounts: [{ id: accountId, household_id: householdId, name: 'Banco' }] };

test.beforeEach(() => { root = new Element(); resetTreasury3(); downloadedName = undefined; blob = undefined; });

test('el botón descarga el saldo introducido sin alterar el saldo calculado', async t => {
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:test'; });
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  renderTreasury3(snapshot);
  const box = root.boxes[0];
  box.querySelector('[data-opening-amount]').value = '-42.15';
  box.querySelector('[data-opening-date]').value = '2026-09-18';
  box.querySelector('[data-download-checkpoint]').onclick();
  const draft = JSON.parse(await blob.text());
  assert.equal(draft.proposal.balance, '-42.15');
  assert.equal(draft.proposal.household_id, householdId);
  assert.equal(draft.persisted, false);
  assert.equal(downloadedName, `domus-saldo-${accountId}-2026-09-18.json`);
  assert.equal(revoke.mock.callCount(), 1);
  assert.match(box.querySelector('[data-balance-result]').textContent, /No se ha guardado/);
  assert.equal(renderTreasury3(snapshot).accountRows[0].confirmedBalance, null);
});

test('los errores de validación son visibles y no descargan ficheros', () => {
  renderTreasury3(snapshot);
  const box = root.boxes[0];
  box.querySelector('[data-opening-amount]').value = '1.005';
  box.querySelector('[data-opening-date]').value = '2026-09-18';
  box.querySelector('[data-download-checkpoint]').onclick();
  assert.equal(box.querySelector('[data-balance-result]').className, 'msg error');
  assert.match(box.querySelector('[data-balance-result]').textContent, /Saldo no válido/);
  assert.equal(downloadedName, undefined);
});

test('conserva el checkpoint al renderizar y lo borra al cambiar usuario u hogar', () => {
  for (const patch of [{ userId: 'user-b' }, { householdId: accountId, accounts: [{ ...snapshot.accounts[0], household_id: accountId }] }]) {
    renderTreasury3(snapshot);
    const box = root.boxes[0];
    box.querySelector('[data-opening-amount]').value = '100';
    box.querySelector('[data-opening-date]').value = '2026-09-18';
    box.querySelector('[data-save-opening]').onclick();
    assert.equal(renderTreasury3(snapshot).accountRows[0].confirmedBalance, 100);
    assert.equal(renderTreasury3({ ...snapshot, ...patch }).accountRows[0].confirmedBalance, null);
    assert.equal(renderTreasury3(snapshot).accountRows[0].confirmedBalance, null);
  }
});

test('reset elimina el panel e invalida botones de una sesión anterior', () => {
  renderTreasury3(snapshot);
  const box = root.boxes[0];
  box.querySelector('[data-opening-amount]').value = '100';
  box.querySelector('[data-opening-date]').value = '2026-09-18';
  resetTreasury3();
  box.querySelector('[data-save-opening]').onclick();
  box.querySelector('[data-download-checkpoint]').onclick();
  assert.equal(root.innerHTML, '');
  assert.equal(downloadedName, undefined);
  assert.equal(renderTreasury3(snapshot).accountRows[0].confirmedBalance, null);
});

test('no ofrece capturas ni borradores de cuentas ajenas o sin hogar', () => {
  renderTreasury3({ ...snapshot, accounts: [...snapshot.accounts, { id: 'foreign', household_id: accountId }] });
  assert.equal(root.boxes.length, 1);
  renderTreasury3({ ...snapshot, householdId: null });
  assert.equal(root.boxes.length, 0);
});

test('una lectura CSV pendiente no reaparece después de cerrar la sesión', async () => {
  renderTreasury3(snapshot);
  select.value = accountId;
  let finish;
  const text = new Promise(resolve => { finish = resolve; });
  const pending = root.querySelector('#treasuryCsv').onchange({ target: { files: [{ name: 'test.csv', text: () => text }] } });
  resetTreasury3();
  finish('Fecha;Concepto;Importe\n2026-09-18;Prueba;10');
  await pending;
  assert.equal(root.innerHTML, '');
});

test('el puente de autenticación limpia al salir o cambiar usuario, no al refrescar el token', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const boot = html.match(/async function boot\(\)\{[^\n]+/)[0];
  let callback, resets = 0;
  const context = { user: null, session: null, passwordRecoveryMode: false,
    window: { DOMUSTreasury3: { reset: () => resets++ } }, setTimeout() {}, routeBySession() {},
    sb: { auth: { onAuthStateChange(fn) { callback = fn; }, async getSession() { return { data: { session: { user: { id: 'a' } } } }; } } } };
  await runInNewContext(`${boot}; boot()`, context);
  callback('TOKEN_REFRESHED', { user: { id: 'a' } });
  assert.equal(resets, 0);
  callback('SIGNED_IN', { user: { id: 'b' } });
  assert.equal(resets, 1);
  callback('SIGNED_OUT', null);
  assert.equal(resets, 2);
});

test('una conciliación confirmada sobrevive al render y queda obsoleta si cambia el movimiento', async () => {
  const source = { ...snapshot, rows: [{ id:'m',type:'expense',amount:10,account_id:accountId,concept:'Compra',status:'done',actual_date:'2026-09-18',occurrence_date:'2026-09-18' }] };
  renderTreasury3(source); select.value = accountId;
  await root.querySelector('#treasuryCsv').onchange({ target: { files: [{ name:'test.csv',text:async()=> 'Fecha;Concepto;Importe\n2026-09-18;Compra;-10' }] } });
  let output = root.querySelector('#treasuryCsvResult');
  output.querySelectorAll('[data-review-confirm]')[0].onclick();
  assert.match(output.innerHTML,/1 confirmadas localmente/);
  renderTreasury3(source);
  assert.match(root.querySelector('#treasuryCsvResult').innerHTML,/1 confirmadas localmente/);
  renderTreasury3({...source,rows:[{...source.rows[0],amount:20}]});
  assert.match(root.querySelector('#treasuryCsvResult').innerHTML,/Los movimientos han cambiado/);
  assert.match(root.querySelector('#treasuryCsvResult').innerHTML,/1 confirmadas localmente/);
  resetTreasury3(); renderTreasury3(source);
  assert.doesNotMatch(root.querySelector('#treasuryCsvResult').innerHTML,/confirmadas localmente/);
});
