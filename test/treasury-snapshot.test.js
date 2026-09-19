import test from 'node:test';
import assert from 'node:assert/strict';
import { createTreasurySnapshot } from '../src/treasury/snapshot.js';
import { readAllPages } from '../src/treasury/data-loading.js';
const input={householdId:'a',userId:'u',asOf:'2026-09-19',series:[{id:'s',household_id:'a',start_date:'2000-01-31',recurrence:'monthly',type:'expense',amount:10}],states:[]};
test('historial completo anterior a cinco años y finales de mes correctos',()=>{
 const snapshot=createTreasurySnapshot(input);
 assert.ok(snapshot.rows.some(r=>r.occurrence_date==='2000-01-31'));
 assert.ok(snapshot.rows.some(r=>r.occurrence_date==='2000-02-29'));
 assert.ok(snapshot.rows.some(r=>r.occurrence_date==='2001-02-28'));
 assert.equal(new Set(snapshot.rows.map(r=>r.id)).size,snapshot.rows.length);
});
test('incluye movimientos futuros ya realizados e impide mezclar hogares',()=>{
 const result=createTreasurySnapshot({...input,series:[...input.series,{id:'b',household_id:'b',start_date:'2026-01-01',recurrence:'none'}],states:[{series_id:'s',occurrence_date:'2030-01-31',actual_date:'2026-09-19',status:'done'}]});
 assert.ok(result.rows.some(r=>r.occurrence_date==='2030-01-31'&&r.status==='done'));
 assert.ok(result.rows.every(r=>r.household_id==='a'));
});
test('carga todas las páginas y no devuelve resultados parciales al fallar',async()=>{
 const data=Array.from({length:1201},(_,id)=>({id}));
 const result=await readAllPages(()=>({range:async(a,b)=>({data:data.slice(a,b+1)})}));
 assert.equal(result.data.length,1201);
 await assert.rejects(()=>readAllPages(()=>({range:async(a,b)=>a?{error:new Error('red')}:{data:data.slice(a,b+1)}})),/red/);
});
