// Domain validation for distinct DOMUS forms. Pure and safe for offline drafts.
const cents = (value, field) => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 999999999999) throw new TypeError(field + ' must be positive integer cents');
  return value;
};
const str = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(field + ' is required');
  return value.trim();
};
export function validateIncomeForm(form) {
  if (!form || typeof form !== 'object') throw new TypeError('Income form required');
  return Object.freeze({kind:'income',concept:str(form.concept,'concept'),amount_cents:cents(form.amount_cents,'amount_cents'),account_id:form.account_id||null,customer:form.customer||null});
}
export function validateExpenseForm(form) {
  if (!form || typeof form !== 'object') throw new TypeError('Expense form required');
  return Object.freeze({kind:'expense',concept:str(form.concept,'concept'),amount_cents:cents(form.amount_cents,'amount_cents'),account_id:form.account_id||null,supplier:form.supplier||null,owner_person_id:form.owner_person_id||null,payer_person_id:form.payer_person_id||null});
}
export function validateTransferForm(form) {
  if (!form || typeof form !== 'object') throw new TypeError('Transfer form required');
  const from_account_id=str(form.from_account_id,'from_account_id'),to_account_id=str(form.to_account_id,'to_account_id');
  if (from_account_id===to_account_id) throw new Error('Transfer accounts must differ');
  return Object.freeze({kind:'transfer',from_account_id,to_account_id,amount_cents:cents(form.amount_cents,'amount_cents'),income_cents:0,expense_cents:0});
}
export function validateSettlementForm(form) {
  if (!form || typeof form !== 'object') throw new TypeError('Settlement form required');
  const invoice_ids=form.invoice_ids;
  if (!Array.isArray(invoice_ids)||!invoice_ids.length||invoice_ids.some(id=>typeof id!=='string'||!id.trim())||new Set(invoice_ids).size!==invoice_ids.length)throw new TypeError('Unique invoice references required');
  if (!Number.isSafeInteger(form.gross_cents)||form.gross_cents<=0)throw new TypeError('Invalid gross');
  if (!Number.isSafeInteger(form.fees_cents)||form.fees_cents<0||form.fees_cents>form.gross_cents)throw new TypeError('Invalid fees');
  if (!Number.isSafeInteger(form.net_cents)||form.net_cents!==form.gross_cents-form.fees_cents)throw new Error('Settlement net does not reconcile');
  return Object.freeze({kind:'settlement',invoice_ids:Object.freeze([...invoice_ids]),gross_cents:form.gross_cents,fees_cents:form.fees_cents,net_cents:form.net_cents,income_cents:0,expense_cents:0});
}
