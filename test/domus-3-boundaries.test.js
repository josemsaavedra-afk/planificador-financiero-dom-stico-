import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTransportERPRecord, planTransportERPImport, isBankCashFlow} from '../src/integration/transporterp-contract.js';
import {missingDefaultCategories, DEFAULT_CATEGORIES} from '../src/catalogs/defaults.js';
import {validateDocumentAmounts} from '../src/documents/amount-validation.js';
const sample = {contract_version:1,source_system:'TransportERP',source_entity_type:'invoice',source_entity_id:'G-1',source_revision:1,household_id:'fixture-A',activity_id:'activity-1',external_document_id:null,date:'2026-10-06',amount_cents:12100,currency:'EUR',status:'confirmed'};
test('TransportERP import is idempotent and handles corrections',()=>{
  const a=planTransportERPImport(sample);
  assert.equal(a.action,'insert');
  assert.equal(planTransportERPImport(sample,a.record).action,'unchanged');
  assert.equal(planTransportERPImport({...sample,source_revision:2,amount_cents:13000},a.record).action,'update');
  assert.equal(planTransportERPImport(sample,planTransportERPImport({...sample,source_revision:2,amount_cents:13000},a.record).record).action,'stale');
});
test('TransportERP rejects cross-household, duplicate revisions and bad amounts',()=>{
  const a=normalizeTransportERPRecord(sample);
  assert.throws(()=>planTransportERPImport({...sample,household_id:'fixture-B'},a));
  assert.throws(()=>planTransportERPImport({...sample,amount_cents:999},a));
  assert.throws(()=>normalizeTransportERPRecord({...sample,amount_cents:12.1}));
  assert.throws(()=>normalizeTransportERPRecord({...sample,date:'2026-02-30'}));
});
test('invoices do not count as bank movements',()=>{
  assert.equal(isBankCashFlow(normalizeTransportERPRecord(sample)),false);
  assert.equal(isBankCashFlow(normalizeTransportERPRecord({...sample,source_entity_type:'receipt'})),true);
});
test('catalog defaults are repeatable and preserve inactive customizations',()=>{
  assert.equal(missingDefaultCategories().length,DEFAULT_CATEGORIES.length);
  assert.equal(missingDefaultCategories(DEFAULT_CATEGORIES).length,0);
  assert.equal(missingDefaultCategories([{name:'alimentacion',kind:'expense',active:false}]).length,DEFAULT_CATEGORIES.length-1);
});
test('PDF arithmetic detects discrepancies and missing fields',()=>{
  assert.equal(validateDocumentAmounts({base_cents:10000,vat_cents:2100,withholding_cents:0,total_cents:12100}).status,'valid');
  assert.equal(validateDocumentAmounts({base_cents:10000,vat_cents:2100,withholding_cents:0,total_cents:12000}).reason,'arithmetic_mismatch');
  assert.equal(validateDocumentAmounts({base_cents:10000,total_cents:12100}).reason,'missing_amount');
});
