import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpatialStars, loadSpatialCatalog } from '../src/space/catalog';
import { PARSEC_AU } from '../src/space/types';
import { formatDistance, formatSpeed } from '../src/space/format';
const star={id:'hyg-test',name:'Test',positionAU:[PARSEC_AU,0,0],absoluteMagnitude:4,bv:.6,distancePc:1,sourceId:'test'};
test('spatial star parser requires finite measured/estimated catalogue distances and consistent vector units',()=>{
 assert.equal(validateSpatialStars([star]).length,1);
 assert.equal(validateSpatialStars([star,star,{...star,id:'unknown',distancePc:99999},{...star,id:'nan',positionAU:[NaN,0,0]},{...star,id:'wrongUnits',positionAU:[1,0,0]},{...star,id:'Sun',distancePc:0,positionAU:[0,0,0]}]).length,1);
 assert.throws(()=>validateSpatialStars({}));
});
test('catalog metadata failure degrades to solar system, never invents spatial distances',async()=>{
 const failed=await loadSpatialCatalog((async()=>{throw new Error('offline')}) as typeof fetch);assert.equal(failed.stars.length,0);assert.match(failed.warning!,/未用虚构星点/);
 const valid=await loadSpatialCatalog((async()=>({ok:true,json:async()=>({catalog:{name:'HYG',version:'4.1'},stars:[star]})})) as typeof fetch);assert.equal(valid.stars.length,1);assert.equal(valid.warning,null);assert.match(valid.description,/J2000/);
});
test('space distance display carries km/AU/light-years instead of an Earth altitude or angular-only scale',()=>{
 assert.match(formatDistance(.00001),/km/);assert.match(formatDistance(1),/AU/);assert.match(formatDistance(PARSEC_AU),/光年/);assert.match(formatSpeed(1),/AU\/s/);assert.equal(formatDistance(NaN),'—');
});
