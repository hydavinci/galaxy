import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNamedCatalog } from '../src/observer/catalog-names';
import { formatLocalDateTime, parseLocalDateTime } from '../src/observer/astronomy';
import { MIN_DATE, MAX_DATE, ViewController } from '../src/observer/controls';

test('UTC endpoints roundtrip through adjacent local calendar years',()=>{
  for(const [ms,zone]of [[MIN_DATE,'America/New_York'],[MAX_DATE,'Asia/Shanghai'],[MIN_DATE,'Pacific/Honolulu'],[MAX_DATE,'Pacific/Kiritimati']] as const){const local=formatLocalDateTime(new Date(ms),zone);assert.equal(parseLocalDateTime(local,zone).getTime(),Math.floor(ms/1000)*1000);}
  assert.throws(()=>parseLocalDateTime('1899-12-31T23:59:59','UTC'));
  assert.throws(()=>parseLocalDateTime('2101-01-01T00:00:00','UTC'));
});
test('star-name failure is metadata degradation, not an unrecoverable sky failure',async()=>{
  const r=await loadNamedCatalog((async()=>{throw new Error('offline');}) as typeof fetch,20);
  assert.deepEqual(r.data,[]);assert.match(r.warning!,/仍可查看星空/);
});
test('star-name request has a bounded timeout even when a fetcher ignores abort',async()=>{
  let signal:AbortSignal|undefined;
  const r=await loadNamedCatalog((async(_url:any,options:any)=>{signal=options.signal;return new Promise(()=>{});}) as typeof fetch,10);
  assert.equal(signal?.aborted,true);assert.match(r.warning!,/超时/);
});
test('star-name payload filters Sol, malformed and nonfinite rows',async()=>{
  const rows=[null,{}, {name:'Sol',ra:0,dec:0,mag:-26.7},{name:'Bad',ra:NaN,dec:0,mag:0},{name:'Fine',ra:1,dec:.5,mag:1}];
  const r=await loadNamedCatalog((async()=>({ok:true,json:async()=>rows})) as typeof fetch);
  assert.equal(r.warning,null);assert.equal(r.data.length,1);assert.equal(r.data[0].name,'Fine');
});
test('camera reaches zenith and nadir even at the smallest FOV',()=>{
  const c=new ViewController();c.reducedMotion=true;
  c.goTo(0,90,.1);c.update(.1);assert.equal(c.camera.altitudeDeg,90);
  c.goTo(0,-90,.1);c.update(.1);assert.equal(c.camera.altitudeDeg,-90);
});
