import test from 'node:test';
import assert from 'node:assert/strict';
import {isolatedPgTarget} from '../scripts/postgres-target.mjs';
test('harness admite exclusivamente base de pruebas local confirmada',()=>{
 const target=isolatedPgTarget('postgresql://fixture:fake@127.0.0.1:55432/domus_test_alpha17','domus_test_alpha17');assert.equal(target.PGPORT,'55432');assert.equal(target.PGDATABASE,'domus_test_alpha17');
});
test('harness rechaza producción, opciones de URL y confirmaciones ausentes',()=>{
 for(const url of ['postgresql://fixture@prod.invalid/domus_test_alpha17','postgresql://fixture@127.0.0.1/postgres','postgresql://fixture@127.0.0.1/domus_test_alpha17?host=prod.invalid','postgresql://fixture@127.0.0.1/domus_test_alpha17#options'])assert.throws(()=>isolatedPgTarget(url,'domus_test_alpha17'));
 assert.throws(()=>isolatedPgTarget('postgresql://fixture@127.0.0.1/domus_test_alpha17',''));
});
