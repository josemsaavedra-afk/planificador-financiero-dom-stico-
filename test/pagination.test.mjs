import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext,Script} from 'node:vm';
const files=['index.html','index-258.html'];
const tables=['people','accounts','categories','documents','movement_series','movement_occurrence_states','household_members','onlogist_operations','movement_links'];
function fixture(file){const html=readFileSync(file,'utf8');const helper=html.slice(html.indexOf('const PAGE_SIZE ='),html.indexOf('async function refreshAll()'));const refresh=html.split('\n').find(l=>l.startsWith('async function refreshAll()'));const c={household:{id:'h'},navigator:{onLine:false},renderAll(){},saveOfflineSnapshot:async()=>{},updateSyncBadge:async()=>{},console:{warn(){}},isNetworkError:()=>false,friendlyCloudError:e=>e.message,alert(){}};runInNewContext(helper+refresh,c);return {c,html}}
for(const file of files){
 test(file+': 10000 ranges, unlimited total and exact multiple termination',async()=>{
  const {c}=fixture(file);
  for(const total of [0,9999,10000,20000,50001]){const ranges=[];const result=await c.fetchAllPages(()=>({range:async(a,b)=>{ranges.push([a,b]);return {data:Array.from({length:Math.min(10000,Math.max(0,total-a))},(_,i)=>({id:a+i})),count:total}}}));assert.equal(result.data.length,total);assert.equal(new Set(result.data.map(x=>x.id)).size,total);assert.deepEqual(ranges,Array.from({length:Math.floor(total/10000)+1},(_,i)=>[i*10000,i*10000+9999]));}
 });
 test(file+': server cap and page failure never silently truncate',async()=>{
  const {c}=fixture(file);const result=await c.fetchAllPages(()=>({range:async(a,b)=>{assert.equal(b-a+1,10000);return {data:Array.from({length:Math.min(1000,2501-a)},(_,i)=>({id:a+i})),count:2501}}}));assert.equal(result.data.length,2501);
  await assert.rejects(()=>c.fetchAllPages(()=>({range:async()=>({data:[],count:10})})),/incompleta/);
  await assert.rejects(()=>c.fetchAllPages(()=>({range:async(a)=>a?{error:new Error('page failed')}:{data:Array(10000).fill({}),count:20000}})),/page failed/);
 });
 test(file+': refresh loads all nine tables with filters and deterministic order',async()=>{
  const {c}=fixture(file);const reads=[];
  c.sb={from(table){const filters=[],orders=[];return {select(_columns,options){if(table!=='treasury_rules')assert.equal(options.count,'exact');return this},eq(k,v){filters.push([k,v]);return this},order(k){orders.push(k);return this},maybeSingle:async()=>({data:{household_id:'h'}}),range:async(a,b)=>{reads.push({table,a,b});if(table!=='movement_occurrence_states')assert.ok(filters.some(([k,v])=>k==='household_id'&&v==='h'));assert.ok(orders.length);if(table==='movement_occurrence_states')assert.deepEqual(orders,['series_id','occurrence_date']);else if(table==='movement_links')assert.deepEqual(orders,['from_series_id','to_series_id','relation_type']);else assert.equal(orders.at(-1),table==='household_members'?'user_id':'id');return {data:Array.from({length:Math.min(10000,20001-a)},(_,i)=>({id:a+i})),count:20001}}}}};
  await c.refreshAll();const arrays=[c.people,c.accounts,c.categories,c.documents,c.series,c.states,c.members,c.onlogistOperations,c.movementLinks];for(const rows of arrays)assert.equal(rows.length,20001);for(const table of tables)assert.equal(reads.filter(r=>r.table===table).length,3);console.log(file+': '+tables.map(t=>t+'=20001').join(', ')+' (simulated)');
 });
 test(file+': inline JavaScript parses',()=>{const {html}=fixture(file);for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!match[1].includes('src=')&&match[2].trim())new Script(match[2]);});
}
