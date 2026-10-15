import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {OBSERVATIONS,OBSERVATION_MAP_SOURCES,observationMap,observationImage,observationImages,surfaceEvidence} from '../src/space/observations';
const credits=JSON.parse(readFileSync(new URL('../public/data/observation-gallery-credits.json',import.meta.url),'utf8'));
const previous=JSON.parse(readFileSync(new URL('../public/data/observation-credits.json',import.meta.url),'utf8'));
const expected=['earth','jupiter','mars','mercury','moon','neptune','saturn','sun','uranus','venus'];
test('two verified global maps and expanded photos for exactly ten targets have complete provenance',()=>{
 assert.deepEqual(OBSERVATIONS.filter(r=>r.kind==='global-map').map(r=>r.id).sort(),['earth','moon']);assert.deepEqual([...new Set(OBSERVATIONS.filter(r=>r.kind==='observation-photo').map(r=>r.id))].sort(),expected);
 for(const id of expected)assert.ok(observationImages(id).filter(r=>r.kind==='observation-photo').length>=2,id);
 assert.ok(credits.newGalleryImageCount>=10);
 for(const r of OBSERVATIONS)for(const k of ['title','sourceUrl','imageSourceUrl','credit','capturedAt','processing','coverage','limitations','license','licenseUrl'] as const)assert.ok(r[k],`${r.id} ${k}`);
 assert.deepEqual(credits.records,OBSERVATIONS);assert.equal(credits.policy,'observation-first');
});
test('public image bytes match recorded acquisition hashes, with exact2K4K map and bounded photograph dimensions',()=>{
 assert.equal(Object.keys(credits.files).length,14+credits.newGalleryImageCount);
 for(const [name,item] of Object.entries(credits.files) as [string,any][]){const bytes=readFileSync(new URL('../public/'+name,import.meta.url));assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);assert.ok(bytes[0]===255&&bytes[1]===216,'JPEG');if(name.startsWith('observations/maps/'))assert.equal(item.width,item.height*2);else assert.ok(Math.max(item.width,item.height)<=1600);}
 for(const r of OBSERVATIONS.filter(r=>r.kind==='global-map'))for(const [tier,path]of Object.entries(r.tiers!)){const f=credits.files[path!.slice(2)];assert.equal(f.width,Number(tier)*1024);assert.equal(f.height,Number(tier)*512);}
});
test('spatial texture allowlist contains no historical artistic maps or photo-as-map fallback',()=>{
 assert.deepEqual(Object.keys(OBSERVATION_MAP_SOURCES).sort(),['earth','moon']);
 for(const paths of Object.values(OBSERVATION_MAP_SOURCES))for(const path of Object.values(paths))assert.match(path!,/^\.\/observations\/maps\//);
 for(const id of expected.filter(id=>!['earth','moon'].includes(id))){assert.equal(observationMap(id),undefined);assert.equal(observationImage(id)?.kind,'observation-photo');assert.match(surfaceEvidence(id),/无已核验全球贴图/);}
});
test('observation caveats are explicit: historical months, NASA source repairs, false color and partial-frame coverage',()=>{
 const earth=observationMap('earth')!,moon=observationMap('moon')!;assert.match(earth.capturedAt,/2004.*8/);assert.match(earth.coverage+earth.limitations,/统一.*蓝|统一颜色/);assert.match(moon.processing+moon.limitations,/inpaint|修补/);assert.match(moon.coverage,/70/);assert.match(moon.coverage,/LOLA/);assert.match(surfaceEvidence('moon'),/源修补/);
 assert.match(observationImage('sun')!.processing,/极紫外/);assert.match(observationImage('venus')!.processing,/假色/);assert.match(observationImage('mars')!.limitations,/局部|区域/);assert.match(observationImage('neptune')!.coverage,/局部/);assert.equal(observationImage('neptune')!.capturedAt,'原页面未注明');
});
test('Ruchbah is not assigned substitute imagery, and the geometric placeholder is never called a real observed surface',()=>{
 assert.equal(observationImage('hyg-6672'),undefined);assert.ok(credits.unavailable.some((r:any)=>r.id==='hyg-6672'));assert.match(surfaceEvidence('hyg-6672',true),/无可用表面影像/);assert.match(surfaceEvidence('hyg-6672',true),/示意/);
});

test('original ten default photos, map records and public file provenance remain unchanged',()=>{
 assert.equal(previous.records.length,12);assert.equal(Object.keys(previous.files).length,14);assert.deepEqual(OBSERVATIONS.slice(0,12),previous.records);
 for(const [name,record] of Object.entries(previous.files))assert.deepEqual(credits.files[name],record,name);
 for(const id of expected)assert.deepEqual(observationImage(id),previous.records.find((r:any)=>r.id===id&&r.kind==='observation-photo'));
});
