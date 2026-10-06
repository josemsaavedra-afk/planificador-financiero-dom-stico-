import test from 'node:test';
import assert from 'node:assert/strict';
import {validateIncomeForm,validateExpenseForm,validateTransferForm,validateSettlementForm} from '../src/finance/operation-forms.js';
test('income and expense have different semantic fields',()=>{
  assert.equal(validateIncomeForm({concept:'Factura',amount_cents:1200,customer:'Empresa'}).customer,'Empresa');
  const expense=validateExpenseForm({concept:'Luz',amount_cents:2100,owner_person_id:'a',payer_person_id:'b'});
  assert.equal(expense.payer_person_id,'b');
  assert.equal(expense.owner_person_id,'a');
  assert.throws(()=>validateIncomeForm({concept:'',amount_cents:1200}));
});
test('own-account transfer does not inflate income or expense',()=>{
  const t=validateTransferForm({from_account_id:'A',to_account_id:'B',amount_cents:10000});
  assert.equal(t.income_cents,0);assert.equal(t.expense_cents,0);
  assert.throws(()=>validateTransferForm({from_account_id:'A',to_account_id:'A',amount_cents:10000}));
  assert.throws(()=>validateTransferForm({from_account_id:'A',to_account_id:'B',amount_cents:-1}));
});
test('settlements reconcile without double counting invoices',()=>{
  const s=validateSettlementForm({invoice_ids:['i1','i2'],gross_cents:10000,fees_cents:1500,net_cents:8500});
  assert.equal(s.net_cents,8500);assert.equal(s.income_cents,0);
  assert.throws(()=>validateSettlementForm({invoice_ids:['i1','i1'],gross_cents:10000,fees_cents:1500,net_cents:8500}));
  assert.throws(()=>validateSettlementForm({invoice_ids:['i1'],gross_cents:10000,fees_cents:1500,net_cents:9000}));
});
