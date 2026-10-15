import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import data from '../src/space/spacecraft-data.json';
import {filterSpacecraft,safeSpacecraftSource,type SpacecraftData,SPACECRAFT_CATEGORIES} from '../src/space/spacecraft';
const catalog=data as SpacecraftData;
const ids=['voyager-1','voyager-2','cassini','juno','new-horizons','parker-solar-probe','lro','perseverance','tianwen-1','change-6','webb','hubble'];
const bodies=['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune'];
test('twelve documented missions have independent identities, required history and full source links',()=>{
 assert.equal(catalog.schemaVersion,1);assert.equal(catalog.verifiedOn,'2026-10-15');assert.match(catalog.notice,/实时/);assert.equal(catalog.records.length,12);assert.deepEqual(catalog.records.map(r=>r.id).sort(),ids.sort());
 for(const r of catalog.records){for(const k of ['id','name','nameEn','agency','category','launchDate','missionType','summary','limitations'] as const)assert.ok(r[k],`${r.id} ${k}`);assert.ok(r.category in SPACECRAFT_CATEGORIES);assert.match(r.launchDate,/^\d{4}-\d{2}-\d{2}$/);assert.ok(r.launchDate<=catalog.verifiedOn);assert.ok(r.targetNames.length);assert.ok(r.instruments.length>=2&&r.instruments.length<=4);assert.ok(r.achievements.length>=2);assert.ok(r.milestones.length>=2);for(const m of r.milestones){assert.match(m.date,/^\d{4}(?:-\d{2})?(?:-\d{2})?$/);assert.ok(m.date<=catalog.verifiedOn);assert.ok(m.label);}for(const s of r.sources){assert.ok(s.label);assert.ok(safeSpacecraftSource(s.url));}assert.ok(r.sources.length);}
});
test('published spacecraft information exactly matches application data and has no fictional current positions',()=>{
 const publicData=readFileSync(new URL('../public/data/spacecraft-info.json',import.meta.url),'utf8');assert.deepEqual(JSON.parse(publicData),catalog);assert.ok(Buffer.byteLength(publicData)<65000);
 for(const r of catalog.records){assert.ok(r.relatedBodyIds.every(id=>bodies.includes(id)));assert.equal(new Set(r.relatedBodyIds).size,r.relatedBodyIds.length);for(const k of ['position','positionAU','orbit','tle','trajectory','velocity','currentStatus'])assert.equal(k in r,false);}
});
test('related-body associations and multilingual lookup expose the intended missions without turning them into navigation objects',()=>{
 const jupiter=filterSpacecraft(catalog.records,'','all','jupiter').map(r=>r.id);assert.ok(jupiter.includes('juno'));assert.ok(jupiter.includes('voyager-1'));assert.ok(filterSpacecraft(catalog.records,'','all','moon').some(r=>r.id==='change-6'));assert.ok(filterSpacecraft(catalog.records,'','all','mars').some(r=>r.id==='tianwen-1'));assert.equal(filterSpacecraft(catalog.records,'','all','hyg-6672').length,0);
 for(const r of catalog.records){assert.ok(filterSpacecraft(catalog.records,r.name).some(x=>x.id===r.id));assert.ok(filterSpacecraft(catalog.records,r.nameEn).some(x=>x.id===r.id));}
});
