import { createTreasurySnapshot } from './snapshot.js';
import { buildCheckpointDraft } from './checkpoint-draft.js';
import { createTreasuryViewModel } from './view-model.js';
import { reconcileStatement, reconciliationSummary } from './reconciliation.js';
import { createReviewSession, decideReview, reviewSummary, selectReviewCandidate } from './reconciliation-review.js';
import { parseStatementCsv } from './statement-csv.js';
import { accountWithLocalCheckpoint, createLocalCheckpoint, validateAccountReconciliation } from './balance-checkpoint.js';
import { buildReconciliationReport, createStatementFingerprint, movementsForStatementAccount, reconciliationReportFileName, serializeReconciliationReport } from './reconciliation-report.js';

const euro = value => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const date = value => value ? new Intl.DateTimeFormat('es-ES').format(new Date(`${value}T12:00:00`)) : 'Sin fecha prevista';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const LABEL = { previsto: 'Previsto', pendiente: 'Pendiente hoy', vencido: 'Vencido', realizado: 'Realizado', reprogramado: 'Reprogramado', prefinanciado: 'Prefinanciado', liquidado: 'Liquidado' };
const localCheckpoints = new Map();
const statementReviews = new Map();
let activeReviewKey = null;
let activeContext = null;
let renderGeneration = 0;

export function resetTreasury3() {
  localCheckpoints.clear();
  statementReviews.clear();
  activeReviewKey = null;
  activeContext = null;
  renderGeneration++;
  const root = document.getElementById('treasury3Root');
  if (root) root.replaceChildren();
}

function statusCards(vm) { return Object.entries(LABEL).map(([status, label]) => { const row = vm.byStatus[status]; return `<button class="card kpi treasury-status-card" type="button" data-treasury-status="${status}"><span class="label">${label}</span><span class="value">${euro(row.net)}</span><span class="sub">${row.count} mov. · +${euro(row.income)} · −${euro(row.expense)}</span></button>`; }).join(''); }
function horizonRows(vm) { const labels = { week: '7 días', month: 'Fin de mes', days30: '30 días', year: 'Fin de año' }; return Object.entries(vm.horizons).map(([key, row]) => `<tr><td><button class="link-button" type="button" data-treasury-horizon="${key}">${labels[key]}</button><small class="muted"> · hasta ${date(row.end)}</small></td><td class="amount income">${euro(row.income)}</td><td class="amount expense">${euro(row.expense)}</td><td class="amount ${row.net < 0 ? 'expense' : 'income'}">${euro(row.net)}</td><td>${row.count}</td></tr>`).join(''); }
function accountRows(vm) { if (!vm.accountRows.length) return '<tr><td colspan="4" class="empty">No hay cuentas configuradas.</td></tr>'; return vm.accountRows.map(row => `<tr><td>${esc(row.name)}</td><td>${row.confirmedBalance == null ? `<span class="muted">${esc(row.balanceReason)}</span>` : `<strong>${euro(row.confirmedBalance)}</strong>`}</td><td class="amount ${row.realFlow < 0 ? 'expense' : 'income'}">${euro(row.realFlow)}</td><td>${row.movements}</td></tr>`).join(''); }
function movementRows(rows) { if (!rows.length) return '<tr><td colspan="5" class="empty">Sin movimientos en este desglose.</td></tr>'; return rows.slice(0, 100).map(row => `<tr><td>${date(row.date)}</td><td><span class="pill">${esc(LABEL[row.status] || row.status)}</span></td><td>${esc(row.concept)}</td><td>${row.type === 'income' ? 'Ingreso' : 'Pago'}</td><td class="amount ${row.type}">${row.type === 'income' ? '+' : '−'}${euro(row.amount)}</td></tr>`).join(''); }
function reconciliationRows(session) { return session.rows.map(row => { const locked = row.decision !== 'pendiente'; return `<tr><td>${date(row.statement.date)}</td><td>${esc(row.statement.concept)}</td><td class="amount ${row.statement.signedAmount < 0 ? 'expense' : 'income'}">${euro(row.statement.signedAmount)}</td><td><span class="pill">${esc(locked ? row.decision : row.matchStatus.replaceAll('_', ' '))}</span></td><td>${row.candidates.length ? `<select class="treasury-review-select" data-review-select="${esc(row.statement.id)}" ${locked ? 'disabled' : ''}><option value="">Seleccionar…</option>${row.candidates.map(candidate => `<option value="${esc(candidate.id)}" ${candidate.id === row.selectedMovementId ? 'selected' : ''}>${esc(candidate.concept)}${candidate.id === row.candidates[0]?.id ? ` · ${row.score}%` : ''}</option>`).join('')}</select>` : 'Sin candidato'}</td><td><div class="actions"><button class="btn primary" type="button" data-review-confirm="${esc(row.statement.id)}" ${locked || !row.selectedMovementId ? 'disabled' : ''}>Confirmar</button><button class="btn" type="button" data-review-discard="${esc(row.statement.id)}" ${locked ? 'disabled' : ''}>Descartar</button></div></td></tr>`; }).join(''); }
function balanceCaptureRows(accounts, asOf) { if (!accounts.length) return '<div class="empty">No hay cuentas configuradas.</div>'; return accounts.map(account => { const checkpoint = localCheckpoints.get(account.id); return `<div class="treasury-balance-form" data-balance-account="${esc(account.id)}"><h3>${esc(account.name || 'Cuenta sin nombre')}</h3><div class="treasury-balance-grid"><label>Saldo inicial confirmado<input data-opening-amount type="number" step="0.01" value="${checkpoint?.amount ?? ''}" placeholder="0,00"></label><label>Fecha del saldo inicial<input data-opening-date type="date" max="${esc(asOf)}" value="${checkpoint?.date ?? ''}"></label><button class="btn" type="button" data-save-opening>Usar localmente</button><label>Saldo bancario a comprobar<input data-closing-amount type="number" step="0.01" placeholder="0,00"></label><label>Fecha del saldo bancario<input data-closing-date type="date" max="${esc(asOf)}" value="${esc(asOf)}"></label><button class="btn primary" type="button" data-check-balance ${checkpoint ? '' : 'disabled'}>Comprobar cuadre</button></div><button class="btn" type="button" data-download-checkpoint>Descargar borrador de saldo</button><div data-balance-result class="muted">${checkpoint ? `Saldo inicial local: ${euro(checkpoint.amount)} a ${date(checkpoint.date)}. No guardado.` : 'Registra primero un saldo inicial. Nada se enviará a Supabase.'}</div></div>`; }).join(''); }

function bindDetails(root, vm) {
  const detail = root.querySelector('#treasury3Detail'), title = root.querySelector('#treasury3DetailTitle'), body = root.querySelector('#treasury3DetailBody');
  const show = (label, rows) => { title.textContent = label; body.innerHTML = movementRows(rows); detail.classList.remove('hidden'); detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  root.querySelectorAll('[data-treasury-status]').forEach(button => button.onclick = () => show(LABEL[button.dataset.treasuryStatus], vm.all.filter(row => row.status === button.dataset.treasuryStatus)));
  root.querySelectorAll('button[data-treasury-horizon]').forEach(button => button.onclick = () => { const horizon = vm.horizons[button.dataset.treasuryHorizon]; show(`Previsión hasta ${date(horizon.end)}`, vm.open.filter(row => row.date <= horizon.end)); });
}

function downloadReport(report, fileName) {
  const url = URL.createObjectURL(new Blob([serializeReconciliationReport(report)], { type: 'application/json;charset=utf-8' })), link = document.createElement('a');
  link.href = url; link.download = reconciliationReportFileName(fileName); document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

function bindReconciliationReview(output, entry, generation) {
  let session = entry.session;
  const metadata = entry.metadata;
  const render = message => {
    if (generation !== renderGeneration) return;
    entry.session = session;
    const summary = reviewSummary(session);
    output.className = '';
    output.innerHTML = `${entry.stale ? '<div class="msg error">Los movimientos han cambiado. Esta revisión conserva las decisiones anteriores y requiere un nuevo análisis antes de confirmar.</div>' : ''}${message ? `<div class="msg ${message.kind}">${esc(message.text)}</div>` : ''}<div class="msg info">Cuenta: <strong>${esc(metadata.account.name)}</strong> · Huella ${esc(metadata.fingerprint.contentSha256.slice(0, 12))}… · Análisis inicial: ${metadata.automatic.propuesto} propuestas, ${metadata.automatic.ambiguo} ambiguas, ${metadata.automatic.revisar} para revisar y ${metadata.automatic.sin_coincidencia} sin coincidencia.</div><div class="section-title treasury-review-summary"><div><strong>${summary.total} líneas</strong> · ${summary.confirmada} confirmadas localmente · ${summary.descartada} descartadas · ${summary.pendiente} pendientes. Nada ha sido guardado.</div><button class="btn" type="button" data-download-review>Descargar informe</button></div><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla desplazable horizontalmente"><table class="table"><thead><tr><th>Fecha</th><th>Extracto</th><th>Importe</th><th>Estado</th><th>Movimiento DOMUS</th><th>Decisión</th></tr></thead><tbody>${reconciliationRows(session)}</tbody></table></div>`;
    output.querySelectorAll('[data-review-select]').forEach(select => select.onchange = () => { if (generation !== renderGeneration || entry.stale) return; try { session = selectReviewCandidate(session, select.dataset.reviewSelect, select.value); render(); } catch (error) { render({ kind: 'error', text: error.message }); } });
    output.querySelectorAll('[data-review-confirm]').forEach(button => button.onclick = () => { if (generation !== renderGeneration || entry.stale) return; try { session = decideReview(session, button.dataset.reviewConfirm, 'confirmada'); render({ kind: 'ok', text: 'Coincidencia confirmada solo para esta revisión local.' }); } catch (error) { render({ kind: 'error', text: error.message }); } });
    output.querySelectorAll('[data-review-discard]').forEach(button => button.onclick = () => { try { session = decideReview(session, button.dataset.reviewDiscard, 'descartada'); render(); } catch (error) { render({ kind: 'error', text: error.message }); } });
    if (entry.stale) output.querySelectorAll('[data-review-confirm], [data-review-select], [data-review-discard]').forEach(control => control.disabled = true);
    output.querySelector('[data-download-review]').onclick = () => {
      if (generation !== renderGeneration) return;
      downloadReport({ ...buildReconciliationReport({ account: metadata.account, fileName: metadata.fileName, fingerprint: metadata.fingerprint, session }), stale: !!entry.stale }, metadata.fileName);
    };
  };
  render();
}

function bindBalanceCapture(root, snapshot, vm, generation) {
  root.querySelectorAll('[data-balance-account]').forEach(box => {
    const account = (snapshot.accounts || []).find(item => item.id === box.dataset.balanceAccount), output = box.querySelector('[data-balance-result]');
    box.querySelector('[data-download-checkpoint]').onclick = () => {
      if (generation !== renderGeneration) return;
      try {
        const draft = buildCheckpointDraft({ householdId: snapshot.householdId, account,
          amount: box.querySelector('[data-opening-amount]').value,
          date: box.querySelector('[data-opening-date]').value, asOf: vm.today });
        const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a');
        try {
          link.href = url; link.download = 'domus-saldo-' + draft.proposal.account_id + '-' + draft.proposal.balance_date + '.json';
          document.body.appendChild(link); link.click();
        } finally { link.remove(); URL.revokeObjectURL(url); }
        output.className = 'msg info';
        output.textContent = 'Borrador descargado. No se ha guardado el saldo ni enviado a Supabase.';
      } catch (error) { output.className = 'msg error'; output.textContent = error.message; }
    };
    box.querySelector('[data-save-opening]').onclick = () => { if (generation !== renderGeneration) return; try { const checkpoint = createLocalCheckpoint({ accountId: account.id, amount: box.querySelector('[data-opening-amount]').value, date: box.querySelector('[data-opening-date]').value }, snapshot.asOf); localCheckpoints.set(account.id, checkpoint); renderTreasury3(snapshot); } catch (error) { output.className = 'msg error'; output.textContent = error.message; } };
    box.querySelector('[data-check-balance]').onclick = () => { if (generation !== renderGeneration) return; try { const result = validateAccountReconciliation({ account, checkpoint: localCheckpoints.get(account.id), realMovements: vm.real, bankBalance: box.querySelector('[data-closing-amount]').value, bankBalanceDate: box.querySelector('[data-closing-date]').value }, snapshot.asOf); output.className = `msg ${result.balanced ? 'ok' : 'error'}`; output.textContent = result.balanced ? `Cuadrado: ${euro(result.calculatedBalance)} con ${result.movements} movimiento(s) reales.` : `Descuadre ${euro(result.difference)}. DOMUS calcula ${euro(result.calculatedBalance)} y el banco indica ${euro(result.observedBalance)}. No se ha corregido nada.`; } catch (error) { output.className = 'msg error'; output.textContent = error.message; } };
  });
}

export function renderTreasury3(snapshot) {
  const root = document.getElementById('treasury3Root'); if (!root || !snapshot) return null;
  const context = JSON.stringify([snapshot.userId || null, snapshot.householdId || null]);
  if (context !== activeContext) { resetTreasury3(); activeContext = context; }
  const generation = ++renderGeneration;
  const sourceAccounts = (snapshot.accounts || []).filter(account => snapshot.householdId && account.household_id === snapshot.householdId), accounts = sourceAccounts.map(account => accountWithLocalCheckpoint(account, localCheckpoints.get(account.id)));
  const vm = createTreasuryViewModel(snapshot.rows || [], accounts, snapshot.asOf || new Date());
  root.innerHTML = `<div class="treasury3-note"><strong>Tesorería 3.0 · Alpha 16</strong> · Los saldos reales y las previsiones se muestran por separado.</div><div class="treasury-status-grid">${statusCards(vm)}</div><div class="grid two treasury3-panels"><div class="card"><h2>Próximo cobro previsto</h2><div class="value">${date(vm.nextIncomeDate)}</div><p>Ingresos: <strong>${euro(vm.nextIncome.income)}</strong> · ${vm.nextIncome.count} movimiento(s)</p><hr><h3>Pagos pendientes hasta entonces</h3><div class="value">${euro(vm.dueBeforeIncomeTotals.expense)}</div><p>${vm.dueBeforeIncomeTotals.count} movimiento(s). Incluye vencidos aún pendientes.</p></div><div class="card"><h2>Saldo calculado por cuenta</h2><p class="muted">Solo se calcula si existe saldo inicial confirmado y fecha. “Flujo real” incluye únicamente movimientos realizados, prefinanciados o liquidados.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla desplazable horizontalmente"><table class="table"><thead><tr><th>Cuenta</th><th>Saldo calculado</th><th>Flujo real</th><th>Mov.</th></tr></thead><tbody>${accountRows(vm)}</tbody></table></div></div></div><div class="card"><h2>Saldos iniciales y cuadre local</h2><p class="muted">El borrador descargable permite revisar el saldo introducido y no lo guarda. Estos datos viven solo en esta pestaña. Sirven para comprobar diferencias y no corrigen movimientos ni se guardan en Supabase.</p>${balanceCaptureRows(sourceAccounts, vm.today)}</div><div class="card"><h2>Previsión acumulada</h2><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla desplazable horizontalmente"><table class="table"><thead><tr><th>Horizonte</th><th>Ingresos</th><th>Pagos</th><th>Neto</th><th>Mov.</th></tr></thead><tbody>${horizonRows(vm)}</tbody></table></div></div><div class="card"><div class="section-title"><div><h2>Conciliación provisional de extracto</h2><p class="muted">El CSV se procesa solo en este navegador. Cada coincidencia requiere una decisión manual y no se guarda.</p></div><label class="btn">Seleccionar CSV<input id="treasuryCsv" type="file" accept=".csv,text/csv" hidden></label></div><div id="treasuryCsvResult" class="empty">Columnas admitidas: fecha, concepto y importe; o fecha, concepto, cargo y abono.</div></div><div id="treasury3Detail" class="card hidden"><div class="section-title"><h2 id="treasury3DetailTitle">Desglose</h2><button class="btn" type="button" id="treasury3Close">Cerrar</button></div><div class="table-wrap" tabindex="0" role="region" aria-label="Tabla desplazable horizontalmente"><table class="table"><thead><tr><th>Fecha</th><th>Estado</th><th>Concepto</th><th>Tipo</th><th>Importe</th></tr></thead><tbody id="treasury3DetailBody"></tbody></table></div></div>`;
  const accountSelect = document.createElement('select');
  accountSelect.id = 'treasuryCsvAccount'; accountSelect.className = 'treasury-review-select'; accountSelect.setAttribute('aria-label', 'Cuenta del extracto');
  accountSelect.innerHTML = '<option value="">Cuenta del extracto…</option>'+sourceAccounts.map(account => `<option value="${esc(account.id)}">${esc(account.name || 'Cuenta sin nombre')}</option>`).join('');
  const fileLabel = root.querySelector('#treasuryCsv').closest('label'); fileLabel.parentElement.insertBefore(accountSelect, fileLabel);
  root.querySelector('#treasury3Close').onclick = () => root.querySelector('#treasury3Detail').classList.add('hidden');
  const signature = accountId => JSON.stringify(movementsForStatementAccount(vm.real, accountId).map(row => [row.id, row.date, row.signedAmount, row.concept]));
  const showReview = key => {
    const entry = statementReviews.get(key); if (!entry) return;
    if (!sourceAccounts.some(account => account.id === entry.metadata.account.id)) return;
    activeReviewKey = key; accountSelect.value = entry.metadata.account.id;
    entry.stale = entry.signature !== signature(entry.metadata.account.id);
    bindReconciliationReview(root.querySelector('#treasuryCsvResult'), entry, generation);
  };
  if (statementReviews.size) {
    const saved = document.createElement('select'); saved.setAttribute('aria-label', 'Revisiones de esta sesión');
    saved.innerHTML = '<option value="">Reabrir revisión…</option>' + [...statementReviews].map(([key,entry]) => '<option value="' + esc(key) + '">' + esc(entry.metadata.account.name + ' · ' + entry.metadata.fileName) + '</option>').join('');
    fileLabel.parentElement.insertBefore(saved, fileLabel); saved.value = activeReviewKey || '';
    saved.onchange = () => { if (generation === renderGeneration) showReview(saved.value); };
  }
  if (activeReviewKey) showReview(activeReviewKey);
  root.querySelector('#treasuryCsv').onchange = async event => {
    const output = root.querySelector('#treasuryCsvResult');
    try {
      const file = event.target.files?.[0], account = sourceAccounts.find(item => item.id === accountSelect.value);
      if (!file) return;
      if (!account) throw new Error('Selecciona la cuenta a la que pertenece el extracto');
      if (file.size > 5 * 1024 * 1024) throw new Error('El CSV supera 5 MB');
      const text = await file.text(), fingerprint = await createStatementFingerprint(account.id, text);
      if (generation !== renderGeneration) return;
      const existing = statementReviews.get(fingerprint.duplicateKey);
      if (existing && !existing.stale) { showReview(fingerprint.duplicateKey); return; }
      const rows = parseStatementCsv(text), results = reconcileStatement(rows, movementsForStatementAccount(vm.real, account.id));
      // A changed source creates a new review; the previous decisions remain downloadable.
      const key = existing ? fingerprint.duplicateKey + ':revision:' + (statementReviews.size + 1) : fingerprint.duplicateKey;
      statementReviews.set(key, { session: createReviewSession(results), signature: signature(account.id), metadata: { account, fileName: file.name, fingerprint, automatic: reconciliationSummary(results) } });
      activeReviewKey = key; renderTreasury3(snapshot);
    } catch (error) { if (generation === renderGeneration) { output.className = 'msg error'; output.textContent = error.message; } }
    finally { event.target.value = ''; }
  };
  bindBalanceCapture(root, { ...snapshot, accounts: sourceAccounts }, vm, generation);
  bindDetails(root, vm); return vm;
}
window.DOMUSTreasury3 = { render: renderTreasury3, reset: resetTreasury3, snapshot: createTreasurySnapshot };
window.dispatchEvent(new CustomEvent('domus-treasury3-ready'));
