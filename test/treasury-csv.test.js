import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatementCsv, parseBankAmount } from '../src/treasury/statement-csv.js';

test('CSV conserva comillas, delimitadores y conceptos multilínea', () => {
  const rows = parseStatementCsv('\uFEFFFecha;Concepto;Importe\r\n19/09/2026;"Compra; \\"especial\\"";"1.234,56"'.replaceAll('\\"','""'));
  assert.equal(rows[0].signedAmount,1234.56);
  const multi = parseStatementCsv('date,description,amount\n2026-09-19,"Línea 1\nLínea 2",12.30');
  assert.equal(multi[0].concept,'Línea 1\nLínea 2');
});
test('rechaza fechas imposibles, sufijos, importes vacíos y errores estructurales', () => {
  for (const line of ['2026-02-30;Compra;10','2026-09-19extra;Compra;10','2026-09-19;Compra;',
    '2026-09-19;Compra;abc','2026-09-19;Compra;1.005','2026-09-19;Compra;0',
    '2026-09-19;Compra;10;extra','2026-09-19;"sin cerrar;10','2026-09-19;;10']) {
    assert.throws(()=>parseStatementCsv('Fecha;Concepto;Importe\n'+line));
  }
});
test('no combina cargo y abono ni columnas ambiguas', () => {
  assert.throws(()=>parseStatementCsv('Fecha;Concepto;Cargo;Abono\n2026-09-19;Compra;10;20'),/simultáneos/);
  assert.throws(()=>parseStatementCsv('Fecha;Concepto;Importe;Amount\n2026-09-19;Compra;10;10'),/ambiguas/);
  assert.throws(()=>parseStatementCsv('Fecha;Concepto;Importe;Cargo\n2026-09-19;Compra;10;10'),/no ambos/);
});
test('interpreta formatos monetarios explícitos y rechaza los ambiguos', () => {
  for(const [raw,value] of [['1.234,56',1234.56],['1,234.56',1234.56],['-1 234,56 EUR',-1234.56],['€ 0,01',0.01]])assert.equal(parseBankAmount(raw),value);
  for(const raw of ['1.234','1,234','1e3','12abc','1 23','--10'])assert.throws(()=>parseBankAmount(raw));
});
test('líneas idénticas conservan identidad distinta por ordinal',()=>{
  const rows=parseStatementCsv('Fecha;Concepto;Importe\n2026-09-19;Igual;-10\n2026-09-19;Igual;-10');
  assert.deepEqual(rows.map(r=>r.ordinal),[1,2]); assert.notEqual(rows[0].id,rows[1].id);
});
