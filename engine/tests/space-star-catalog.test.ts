import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CatalogStar3D, Vec3 } from '../src/space/types';
import { PARSEC_AU } from '../src/space/types';

const engine = fileURLToPath(new URL('../', import.meta.url));
const asset = readFileSync(new URL('../public/data/space-stars.json', import.meta.url));
const creditBytes = readFileSync(new URL('../public/data/space-stars-credits.json', import.meta.url));
const document = JSON.parse(asset.toString('utf8'));
const credits = JSON.parse(creditBytes.toString('utf8'));
const stars: CatalogStar3D[] = document.stars;
const byId = new Map(stars.map(star => [star.id, star]));
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const expectedSourceHash = 'd9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd';
const sourceCommit = 'c7f7f883fe678cc7680169a50ccd7dcc49b060ce';
const python = String.raw`
import sys, importlib.util, math, json, csv, io, hashlib, collections
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('space_catalog', Path('scripts/spacecatalog/generate.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;
function runPython(body: string): void {
  const run = spawnSync('python3', ['-c', python + '\n' + body], {
    cwd: engine, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 30000,
  });
  assert.equal(run.status, 0, `${run.error ?? ''}\n${run.stdout}\n${run.stderr}`);
}
function subtract(a: Vec3, b: Vec3): Vec3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function angularSeparation(a: Vec3, b: Vec3): number {
  const cross = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  return Math.atan2(Math.hypot(...cross), a[0]*b[0]+a[1]*b[1]+a[2]*b[2]);
}

test('space star asset obeys the shared finite-distance CatalogStar3D schema', () => {
  assert.equal(document.schemaVersion, 1);
  assert.equal(document.frame, 'J2000 EQJ Y-up');
  assert.equal(document.units, 'AU');
  assert.equal(PARSEC_AU, 206264.80624709636);
  assert.equal(stars.length, 9078);
  assert.ok(stars.length <= 10000);
  assert.equal(document.catalog.limits.truncated, false);
  assert.equal(document.catalog.limits.recordCount, stars.length);
  assert.equal(byId.size, stars.length);
  let maxDistanceError = 0;
  for (const star of stars) {
    assert.match(star.id, /^hyg-[1-9]\d*$/);
    assert.equal(star.id, `hyg-${star.sourceId}`);
    assert.equal(typeof star.name, 'string');
    assert.ok(star.name.length > 0);
    assert.equal(star.positionAU.length, 3);
    assert.ok([...star.positionAU, star.bv, star.absoluteMagnitude, star.distancePc].every(Number.isFinite));
    assert.ok(star.distancePc > 0 && star.distancePc <= 100);
    maxDistanceError = Math.max(maxDistanceError, Math.abs(Math.hypot(...star.positionAU)/PARSEC_AU-star.distancePc));
    assert.equal('radiusKm' in star, false, 'no invented stellar surface radius');
    assert.equal('textureId' in star, false, 'no invented stellar photograph');
  }
  assert.ok(maxDistanceError < 6e-14, `distance conversion error ${maxDistanceError} pc`);
});

test('HYG Sol is excluded: Sun remains the separately ephemeris-owned origin', () => {
  assert.equal(byId.has('hyg-0'), false);
  assert.equal(document.catalog.limits.sunExcluded, true);
  assert.equal(stars.some(s => /^(sol|sun)$/i.test(s.name)), false);
  assert.equal(stars.some(s => s.positionAU.every(x => x === 0)), false);
  // HYG does not duplicate the ten moving Solar-system bodies with arbitrary coordinates.
  for (const body of ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    assert.equal(byId.has(body), false);
  }
});

test('only documented Gl 166 B/C source components share an exact position', () => {
  const groups = new Map<string, string[]>();
  for (const star of stars) {
    const key = JSON.stringify(star.positionAU);
    groups.set(key, [...groups.get(key) ?? [], star.id]);
  }
  const duplicates = [...groups.values()].filter(g => g.length > 1).map(g => g.sort());
  assert.equal(groups.size, 9077);
  assert.deepEqual(duplicates, [['hyg-118281', 'hyg-118282']]);
  const notes = credits.exactPositionDuplicateGroups;
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].ids, duplicates[0]);
  assert.deepEqual(notes[0].sourceComponents, ['2', '3']);
  assert.equal(notes[0].sourcePrimaryId, '19799');
  assert.match(notes[0].reason, /without fabricated/);
  assert.notDeepEqual(byId.get('hyg-71453')!.positionAU, byId.get('hyg-71456')!.positionAU);
});

test('live-verified official source is commit/hash pinned and derivative preserves CC BY-SA 4.0', () => {
  const catalog = document.catalog;
  assert.equal(catalog.version, '4.1');
  assert.equal(catalog.sha256, expectedSourceHash);
  assert.equal(catalog.commit, sourceCommit);
  assert.equal(catalog.url, `https://raw.githubusercontent.com/astronexus/HYG-Database/${sourceCommit}/hyg/CURRENT/hygdata_v41.csv`);
  assert.equal(catalog.epoch, 'J2000.0 (epoch and equinox)');
  assert.equal(catalog.sourceLicense, 'CC-BY-SA-4.0');
  assert.equal(catalog.derivedDataLicense, 'CC-BY-SA-4.0');
  assert.equal(credits.sourceLicense, 'CC-BY-SA-4.0');
  assert.equal(credits.derivedDataLicense, 'CC-BY-SA-4.0');
  assert.equal(credits.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(credits.attribution, /David Nash \/ Astronomy Nexus/);
  assert.match(credits.sourceLicenseNotice, /Creative Commons Attribution-ShareAlike 4.0 International License/);
  assert.equal(credits.source.currentProjectUrl, 'https://codeberg.org/astronexus/hyg');
  assert.equal(credits.assetSha256, hash(asset));
  assert.equal(credits.assetBytes, asset.byteLength);
  assert.match(credits.limitations.join('\n'), /not a complete census/);
  assert.match(credits.limitations.join('\n'), /heterogeneous quality/);
  assert.match(credits.limitations.join('\n'), /No proper-motion/);
  assert.match(credits.limitations.join('\n'), /not resolved photos/);
});

test('raw source SHA256, official Git blob, README epoch and license prove reproducibility', () => {
  runPython(String.raw`
source=m.verified_inputs(False)
assert hashlib.sha256(source).hexdigest() == '${expectedSourceHash}'
tree=json.loads((m.FIXTURES/'source-tree-entry.json').read_text())
assert tree['commit'] == '${sourceCommit}' and tree['sourceTreeTruncated'] is False
entry=tree['entry']
assert entry['path']==m.SOURCE_PATH
assert entry['sha']==m.SOURCE_GIT_BLOB and entry['size']==len(source)
assert 'epoch and equinox of 2000.0' in (m.FIXTURES/'hyg-README.md').read_text()
payload,credits,report=m.make_artifacts(source)
assert payload==(m.PUBLIC/'space-stars.json').read_bytes()
assert credits==(m.PUBLIC/'space-stars-credits.json').read_bytes()
assert report['sourceRows']==119626 and report['outputRows']==9078
assert sum(report['exclusions'].values())+report['outputRows']==report['sourceRows']
`);
});

test('all output photometry and names come from the matching original CSV rows', () => {
  runPython(String.raw`
source=m.verified_inputs(False)
rows={r['id']:r for r in csv.DictReader(io.StringIO(source.decode('utf8')))}
asset=json.loads((m.PUBLIC/'space-stars.json').read_text())
for s in asset['stars']:
 r=rows[s['sourceId']]
 v,reason=m.validated_row(r)
 assert v is not None and reason is None
 assert s['distancePc']==float(r['dist'])
 assert s['absoluteMagnitude']==float(r['absmag'])
 assert s['bv']==float(r['ci'])
 assert s['name']==m.default_name(r)
 ra=float(r['ra'])*math.pi/12; dec=float(r['dec'])*math.pi/180
 expected=[math.cos(dec)*math.cos(ra),math.sin(dec),math.cos(dec)*math.sin(ra)]
 for actual,direction in zip(s['positionAU'],expected):
  assert abs(actual-float(r['dist'])*m.PARSEC_AU*direction)<1e-8
# IDs with coincident positions are two real published source components, not duplication in conversion.
assert rows['118281']['gl']=='Gl 166B' and rows['118282']['gl']=='Gl 166C'
assert rows['118281']['comp_primary']==rows['118282']['comp_primary']=='19799'
`);
});

test('rejects unknown-distance sentinels, NaNs and absent B-V rather than inventing values', () => {
  runPython(String.raw`
valid={'id':'123','proper':'','ra':'6','dec':'20','dist':'3','mag':'10','absmag':'12','ci':'1.5'}
assert m.validated_row(valid)[0] is not None
for distance in ['0','-1','99999','100000','inf','-inf','nan','']:
 assert m.validated_row({**valid,'dist':distance})[0] is None,distance
for field in m.REQUIRED_KEYS:
 for value in ['', 'nan', 'inf', '-inf', 'unmeasured']:
  assert m.validated_row({**valid,field:value})[0] is None,(field,value)
for field,value in [('ra','-0.1'),('ra','24'),('dec','90.1'),('dec','-90.1')]:
 assert m.validated_row({**valid,field:value})[0] is None
assert m.validated_row({**valid,'id':'0'})[1]=='sun_already_in_solar_system'
assert m.validated_row({**valid,'proper':'Sol'})[1]=='sun_already_in_solar_system'
assert m.validated_row({**valid,'dist':'50','mag':'12'})[0] is not None
assert m.validated_row({**valid,'dist':'50.001','mag':'12'})[0] is None
assert m.validated_row({**valid,'dist':'100','mag':'6.5'})[0] is not None
assert m.validated_row({**valid,'dist':'100.001','mag':'6.5'})[0] is None
assert m.validated_row({**valid,'dist':'50','mag':'12.001'})[0] is None
`);
});

test('axis convention and known Sirius/Alpha Centauri/Proxima directions match J2000 catalog values', () => {
  runPython(String.raw`
for ra,dec,wanted in [(0,0,[1,0,0]),(6,0,[0,0,1]),(0,90,[0,1,0]),(0,-90,[0,-1,0])]:
 p=m.position_au(ra,dec,1)
 assert all(abs(x/m.PARSEC_AU-y)<1e-15 for x,y in zip(p,wanted))
`);
  const known = [
    ['hyg-32263', 'Sirius', 6.752481, -16.716116, 2.6371, -1.44],
    ['hyg-70666', 'Proxima Centauri', 14.495985, -62.679485, 1.2959, 11.01],
    ['hyg-71456', 'Rigil Kentaurus', 14.660765, -60.833976, 1.3248, -0.01],
    ['hyg-71453', 'Toliman', 14.660346, -60.8383, 1.3248, 1.35],
  ] as const;
  for (const [id, name, ra, dec, distance, magnitude] of known) {
    const star = byId.get(id)!;
    assert.ok(star);
    assert.equal(star.name, name);
    assert.equal(star.distancePc, distance);
    const [x,y,z] = star.positionAU;
    const reconstructedRa = ((Math.atan2(z,x)*12/Math.PI)%24+24)%24;
    const reconstructedDec = Math.atan2(y,Math.hypot(x,z))*180/Math.PI;
    assert.ok(Math.abs(reconstructedRa-ra)<1e-12);
    assert.ok(Math.abs(reconstructedDec-dec)<1e-12);
    assert.ok(Math.abs(star.absoluteMagnitude+5*Math.log10(star.distancePc)-5-magnitude)<0.001,
      'distance modulus consistent to source magnitude rounding');
  }
  const sirius = byId.get('hyg-32263')!;
  assert.ok(sirius.positionAU[0]<0 && sirius.positionAU[1]<0 && sirius.positionAU[2]>0,
    'Sirius RA~6.75h, southern Dec must be negative X/Y and positive Z in Y-up world');
});

test('actual sample bounds and total public data footprint are explicit and bounded', () => {
  const bounds = document.catalog.limits.actualBounds;
  assert.equal(Math.min(...stars.map(s=>s.distancePc)), 1.2959);
  assert.equal(Math.max(...stars.map(s=>s.distancePc)), 100);
  assert.deepEqual(bounds.distancePc, { min: 1.2959, max: 100 });
  assert.deepEqual(bounds.absoluteMagnitude, { min: -5.504, max: 15.447 });
  assert.deepEqual(bounds.bv, { min: -0.243, max: 2.8 });
  assert.equal(document.catalog.limits.nearbyMaxDistancePc, 50);
  assert.equal(document.catalog.limits.nearbyMaxApparentMagnitude, 12);
  assert.equal(document.catalog.limits.brightShellMaxDistancePc, 100);
  assert.equal(document.catalog.limits.brightShellMaxApparentMagnitude, 6.5);
  assert.ok(asset.byteLength + creditBytes.byteLength < 1_800_000);
  assert.ok(gzipSync(asset).byteLength + gzipSync(creditBytes).byteLength < 510_000);
});

test('translating a camera yields finite catalog parallax at fixed optical field of view', () => {
  const camera0: Vec3 = [0,0,0], camera1: Vec3 = [10000,0,0];
  const fov = 60;
  const expected = [
    ['hyg-70666',1.9684930702679293,0.7186006533229556],
    ['hyg-71456',1.9177888615739829,0.700108983066916],
    ['hyg-32263',1.031008136391162,0.37248212916128626],
  ] as const;
  for (const [id, degrees, oneAUArcsec] of expected) {
    const p = byId.get(id)!.positionAU;
    const ray0 = subtract(p,camera0), ray1 = subtract(p,camera1);
    const observed = angularSeparation(ray0,ray1)*180/Math.PI;
    assert.ok(Math.abs(observed-degrees)<1e-11);
    const oneAU = angularSeparation(ray0, subtract(p,[1,0,0]))*180/Math.PI*3600;
    assert.ok(Math.abs(oneAU-oneAUArcsec)<1e-8);
    assert.notEqual(Math.hypot(...ray0), Math.hypot(...ray1));
    assert.equal(fov,60);
    // A unit-sphere catalog at artificial fixed observer direction would yield zero;
    // no FOV adjustment is used to generate the measured angular displacement.
    assert.ok(observed>1);
  }
  const proxima = byId.get('hyg-70666')!.positionAU;
  const sirius = byId.get('hyg-32263')!.positionAU;
  assert.ok(Math.abs(angularSeparation(proxima,sirius) -
    angularSeparation(subtract(proxima,camera1),subtract(sirius,camera1)))>0.01);
});

test('redundant source-coordinate discrepancy is disclosed, not silently mixed or fabricated', () => {
  assert.equal(credits.redundantCoordinateDisagreements.length,1);
  assert.equal(credits.redundantCoordinateDisagreements[0].sourceId,'119616');
  assert.ok(credits.redundantCoordinateDisagreements[0].decDifferenceArcsec>562);
  const star=byId.get('hyg-119616')!;
  const reconstructedDec = Math.atan2(star.positionAU[1],Math.hypot(star.positionAU[0],star.positionAU[2]))*180/Math.PI;
  assert.ok(Math.abs(reconstructedDec-(-16.590778))<1e-12,
    'documented dec degrees retained instead of inconsistent redundant decrad field');
});
