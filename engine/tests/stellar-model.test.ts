import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getStellarModel, stellarBody } from '../src/space/stellar-model';
import { AU_KM, PARSEC_AU, type CatalogStar3D } from '../src/space/types';
import { computeSpace } from '../src/space/world';
import { bodyFrame, bodyHitDistance } from '../src/space/render-math';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path:string) => readFileSync(new URL('../' + path, import.meta.url));
const sha = (bytes:Buffer|string) => createHash('sha256').update(bytes).digest('hex');
const catalogBytes = read('public/data/space-stars.json');
const stars:CatalogStar3D[] = JSON.parse(catalogBytes.toString()).stars;
const byName = new Map(stars.map(star => [star.name, star]));
const metadata = JSON.parse(read('src/space/stellar-metadata.json').toString());
const credits = JSON.parse(read('public/data/stellar-model-credits.json').toString());
const rows = new Map<string, [number,number|null,string,number,number]>(metadata.rows.map((row:any) => [`hyg-${row[0]}`, row]));
const solarRadius = 695700, solarTemperature = 5772;
const clone = (star:CatalogStar3D):CatalogStar3D => ({...star, positionAU:[...star.positionAU]});
function close(a:number,b:number,relative=1e-12):void {
  assert.ok(Math.abs(a-b) <= relative * Math.max(Math.abs(a),Math.abs(b),1e-20), `${a} != ${b}`);
}

// Independent formulas: use exp(x)-1 rather than the implementation's expm1.
function independentBvTemperature(bv:number):number {
  return 4600/(0.92*bv+1.7) + 4600/(0.92*bv+0.62);
}
function independentRadius(mv:number,temperature:number):number {
  const h=6.62607015e-34,c=299792458,k=1.380649e-23,lambda=550e-9;
  const planck=(t:number) => 2*h*c*c/(lambda**5*(Math.exp(h*c/(lambda*k*t))-1));
  return solarRadius * Math.sqrt(10**((4.81-mv)/2.5)*planck(solarTemperature)/planck(temperature));
}

test('all 9078 retained catalog stars have finite positive honest models and exact cross identifiers', () => {
  let referenceRadii=0, referenceTemperatures=0, hip=0, raw=0, fallback=0;
  const before=JSON.stringify(stars);
  for (const star of stars) {
    const model=getStellarModel(star)!;
    assert.ok(model, star.id);
    for (const value of [model.radiusKm,model.temperatureK,model.luminositySolar]) assert.ok(Number.isFinite(value)&&value>0,star.id);
    assert.ok(model.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
    assert.ok(Number.isFinite(model.seed)&&model.seed>=0&&model.seed<=1);
    assert.equal(model.spectralType,rows.get(star.id)![2]||null);
    assert.equal(model.hipNumber,rows.get(star.id)![1]??undefined);
    assert.match(model.radiusSource,model.estimatedRadius?/估算/:/参考/);
    assert.match(model.temperatureSource,model.estimatedTemperature?/估算/:/参考/);
    assert.equal(model.estimatedLuminosity,true);
    assert.match(model.luminositySource,/估算.*Stefan/);
    assert.match(model.luminositySource,/非HYG视觉光度/);
    assert.ok(model.references.length>=3&&model.references.every(url=>/^https?:\/\//.test(url)));
    referenceRadii+=+!model.estimatedRadius;
    referenceTemperatures+=+!model.estimatedTemperature;
    hip+=+(model.hipNumber!==undefined);
    raw+=+(model.spectralType!==null);
    fallback+=+/降级/.test(model.temperatureSource);
    assert.ok(stellarBody(star));
  }
  assert.equal(stars.length,9078);
  assert.deepEqual({referenceRadii,referenceTemperatures,hip,raw,fallback},
    {referenceRadii:3,referenceTemperatures:4,hip:8840,raw:8656,fallback:10});
  assert.equal(JSON.stringify(stars),before,'no added stellar fields/coordinates on old catalog objects');
});

test('four literature anchors resolve actual names and actual HIP IDs, not guessed numeric identity', () => {
  const anchors=[
    ['Scheat','hyg-113521',113881,95,3700,false],
    ['Sirius','hyg-32263',32349,1.711,9900,false],
    ['Proxima Centauri','hyg-70666',70890,0.146,2980,false],
    ['Vega','hyg-90979',91262,Math.cbrt(2.726**2*2.418),9360,true],
  ] as const;
  for (const [name,id,hip,r,t,estimatedRadius] of anchors) {
    const star=byName.get(name)!;
    assert.equal(star.id,id);
    const model=getStellarModel(star)!;
    assert.equal(model.hipNumber,hip);
    close(model.radiusKm,r*solarRadius);
    assert.equal(model.temperatureK,t);
    assert.equal(model.estimatedRadius,estimatedRadius);
    assert.equal(model.estimatedTemperature,false);
    assert.equal(model.estimatedLuminosity,true);
    assert.equal(getStellarModel({...star,id:`hyg-${hip}`,sourceId:String(hip)}),null,'HIP number is not HYG ID');
  }
  const scheat=getStellarModel(byName.get('Scheat')!)!;
  assert.equal(scheat.spectralType,'M2II-IIIvar');
  assert.ok(scheat.luminositySolar>1500&&scheat.luminositySolar<1550);
  assert.ok(scheat.radiusKm>60_000_000,'not a solar-size fallback or arbitrary giant cap');
  const vega=getStellarModel(byName.get('Vega')!)!;
  assert.match(vega.radiusSource,/等体积球/);
  assert.match(vega.temperatureSource,/表面平均.*纬度差/);
  assert.ok(vega.luminositySolar>45&&vega.luminositySolar<49);
});

test('all luminosities agree with displayed radius/temperature; general radii use visual surface brightness', () => {
  const anchors=new Set(['Scheat','Sirius','Proxima Centauri','Vega']);
  const radii=new Set<number>();
  for (const star of stars) {
    const m=getStellarModel(star)!;
    radii.add(m.radiusKm);
    close(m.luminositySolar,(m.radiusKm/solarRadius)**2*(m.temperatureK/solarTemperature)**4);
    close(stellarBody(star)!.radiusKm/AU_KM,m.radiusKm/149597870.7);
    if (!anchors.has(star.name)) {
      const t=independentBvTemperature(Math.min(star.bv,2));
      close(m.temperatureK,t);
      close(m.radiusKm,independentRadius(star.absoluteMagnitude,t));
    }
  }
  assert.ok(radii.size>9000,'not all stars the Sun, nor class-bucket radius assignments');
  // The solar calibration is exact when supplied its own reference temperature.
  close(independentRadius(4.81,5772),solarRadius);
  // Red-star bolometric output cannot simply be the HYG V-magnitude luminosity.
  const proxima=byName.get('Proxima Centauri')!, p=getStellarModel(proxima)!;
  assert.ok(p.luminositySolar / 10**(0.4*(4.85-proxima.absoluteMagnitude)) > 20);
});

test('raw uncertain/missing spectral types are preserved, never mislabeled as secure inferred physics', () => {
  const capella=getStellarModel(byName.get('Capella')!)!;
  assert.equal(capella.spectralType,'M1: comp');
  assert.match(capella.classification,/不确定\/复合/);
  assert.ok(capella.estimatedRadius&&capella.estimatedTemperature);
  assert.ok(capella.temperatureK>5000,'use color, not erroneous raw M class temperature');
  const missing=stars.find(s=>!rows.get(s.id)![2])!;
  const model=getStellarModel(missing)!;
  assert.equal(model.spectralType,null);
  assert.match(model.classification,/光谱未载/);
  assert.ok(model.estimatedRadius&&model.estimatedTemperature);
  const giant=stars.find(s=>/III/.test(rows.get(s.id)![2])&&!metadata.anchors.some((a:any)=>`hyg-${a.id}`===s.id))!;
  assert.match(getStellarModel(giant)!.classification,/目录/);
  const hot=stars.reduce((a,b)=>a.bv<b.bv?a:b);
  const cool=byName.get('Proxima Centauri')!;
  const hotColor=getStellarModel(hot)!.color,coolColor=getStellarModel(cool)!.color;
  assert.ok(hotColor[2]>hotColor[0]);
  assert.ok(coolColor[0]>coolColor[2]);
});

test('all ten red out-of-domain records have disclosed fallback rather than silent extrapolation', () => {
  const outliers=stars.filter(star=>star.bv>2);
  assert.equal(outliers.length,10);
  for (const star of outliers) {
    const model=getStellarModel(star)!;
    assert.match(model.classification,/超范围.*降级/);
    assert.match(model.radiusSource,/降级示意/);
    assert.match(model.temperatureSource,/B−V=2.0边界色温.*非该星有效温度测量/);
    assert.match(model.luminositySource,/降级假设/);
    close(model.temperatureK,independentBvTemperature(2));
    assert.ok(model.estimatedRadius&&model.estimatedTemperature&&model.estimatedLuminosity);
  }
});

test('invalid or unsupported inputs fail closed, including mutated cached objects and fake anchor names', () => {
  const star=clone(byName.get('Sirius')!);
  const mutations:Partial<CatalogStar3D>[]=[
    {id:'not-a-catalog-record'}, {id:'hyg-0',sourceId:'0'}, {sourceId:'32349'},
    {id:'hyg-999999999',sourceId:'999999999'},
    {bv:NaN},{bv:Infinity},{bv:-100},{bv:3},{bv:star.bv+0.001},
    {absoluteMagnitude:NaN},{absoluteMagnitude:1e9},{absoluteMagnitude:star.absoluteMagnitude+0.01},
    {distancePc:0},{distancePc:-1},{distancePc:99999},{distancePc:Infinity},{distancePc:NaN},
    {positionAU:[0,0,0]},{positionAU:[NaN,0,0]},{positionAU:[Infinity,0,0]},
    {positionAU:[1,2,3]},
  ];
  for (const mutation of mutations) {
    const input={...star,...mutation};
    assert.equal(getStellarModel(input),null,JSON.stringify(mutation));
    assert.equal(stellarBody(input),null);
  }
  for (const input of [null,undefined,{},[],{name:'Scheat'},{id:'sun'}]) {
    assert.equal(getStellarModel(input as CatalogStar3D),null);
    assert.equal(stellarBody(input as CatalogStar3D),null);
  }
  assert.ok(getStellarModel(star));
  star.bv=NaN;
  assert.equal(getStellarModel(star),null,'cache cannot bypass invalid photometry');
  star.bv=byName.get('Sirius')!.bv;
  star.positionAU[0]=Infinity;
  assert.equal(stellarBody(star),null,'cache cannot bypass invalid position');
  const synthetic:CatalogStar3D={id:'test-star',name:'Sirius',sourceId:'test-star',
    positionAU:[PARSEC_AU,0,0],distancePc:1,bv:0,absoluteMagnitude:1};
  assert.equal(getStellarModel(synthetic),null);
});

test('cached model/body identities are stable, frozen and deterministic across object copies', () => {
  const star=clone(byName.get('Scheat')!);
  const m=getStellarModel(star)!,b=stellarBody(star)!;
  for (let i=0;i<1000;i++) {
    assert.equal(getStellarModel(star),m);
    assert.equal(stellarBody(star),b);
  }
  assert.ok(Object.isFrozen(m)&&Object.isFrozen(m.color)&&Object.isFrozen(m.references)&&Object.isFrozen(b));
  assert.deepEqual(getStellarModel(clone(star)),m);
  star.nameZh='室宿二';
  const localized=stellarBody(star)!;
  assert.notEqual(localized,b);
  assert.equal(localized.name,'室宿二');
  assert.equal(localized.nameEn,'Scheat');
  assert.equal(getStellarModel(star),m);
  const other=getStellarModel(byName.get('Sirius')!)!;
  assert.notEqual(other.seed,m.seed);
});

test('stellar optical adapters preserve coordinates, no planet texture or snapshot insertion', () => {
  const snapshot=computeSpace(new Date('2026-10-14T12:00:00Z'));
  const snapshotBefore=JSON.stringify(snapshot);
  for (const star of stars) {
    const b=stellarBody(star)!;
    assert.equal(b.id,star.id);
    assert.equal(b.positionAU,star.positionAU);
    assert.equal(b.name,star.nameZh||star.name);
    assert.equal(b.kind,'star');
    assert.equal(b.textureId,'');
    assert.equal(b.parentId,undefined);
    assert.match(b.color,/^#[0-9a-f]{6}$/);
    assert.deepEqual(b.axisNorth,[0,1,0]);
    assert.deepEqual(b.axisPrime,[1,0,0]);
    assert.deepEqual(b.axisEast,[0,0,1]);
  }
  assert.equal(snapshot.bodies.length,10);
  assert.equal(JSON.stringify(snapshot),snapshotBefore);
  const a=stars.find(s=>s.id==='hyg-118281')!,b=stars.find(s=>s.id==='hyg-118282')!;
  assert.deepEqual(stellarBody(a)!.positionAU,stellarBody(b)!.positionAU);
  assert.notEqual(stellarBody(a)!.id,stellarBody(b)!.id);
});

test('metadata is compact, embedded and correctly licensed without original HIP or new runtime requests', () => {
  const bytes=read('src/space/stellar-metadata.json');
  assert.ok(bytes.length<=512*1024);
  assert.equal(credits.derivative.bytes,bytes.length);
  assert.equal(credits.derivative.sha256,sha(bytes));
  assert.equal(credits.derivative.rows,9078);
  assert.equal(credits.source.sha256,'d9f69fd86bbf90a4e4d52b4c5c53eacfa6dfc0bfdef85bfd94f095e0bebe4ebd');
  assert.equal(credits.source.commit,'c7f7f883fe678cc7680169a50ccd7dcc49b060ce');
  assert.equal(credits.source.originalHipparcosImported,false);
  assert.equal(credits.derivative.runtimeExtraFetch,false);
  assert.equal(credits.sourceLicense,'CC-BY-SA-4.0');
  assert.equal(credits.derivedDataLicense,'CC-BY-SA-4.0');
  assert.equal(credits.licenseUrl,'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.match(credits.attribution,/David Nash \/ Astronomy Nexus/);
  assert.equal(credits.model.arbitraryRadiusClamp,false);
  const source=read('src/space/stellar-model.ts').toString();
  assert.doesNotMatch(source,/\bfetch\s*\(|\bXMLHttpRequest\b|\bnew\s+Image\b/);
  assert.doesNotMatch(source,/\bMath\.random\s*\(/);
});

test('all stellar adapters retain real radius in close-up optics and center-hit geometry at fixed FOV', () => {
  for (const star of stars) {
    const body=stellarBody(star)!,r=body.radiusKm/AU_KM;
    const camera={positionAU:[star.positionAU[0],star.positionAU[1],star.positionAU[2]+4.5*r] as [number,number,number],
      azimuthDeg:0,altitudeDeg:0,fovDeg:60};
    const frame=bodyFrame(body,[0,0,0],camera,1000,600)!;
    assert.ok(frame,star.id);
    close(frame.radiusAU,r);
    close(frame.radius,1/4.5,1e-5); // double subtraction at up to 100 pc, not a fake enlarged radius
    const distance=camera.positionAU[2]-star.positionAU[2];
    const expectedPixels=300/Math.tan(Math.PI/6)*r/Math.sqrt(distance*distance-r*r);
    close(frame.radiusCssPixels,expectedPixels);
    close(bodyHitDistance(frame,500,300,1000,600,camera)!,distance-r);
    assert.equal(bodyHitDistance(frame,500+frame.radiusCssPixels+1,300,1000,600,camera),null);
    camera.positionAU[2]=star.positionAU[2]+9*r;
    const farther=bodyFrame(body,[0,0,0],camera,1000,600)!;
    assert.ok(farther.radiusCssPixels<frame.radiusCssPixels);
    assert.equal(camera.fovDeg,60);
  }
});

test('generator independently rechecks all exact CSV rows and reproduces every generated byte', () => {
  for (let i=0;i<2;i++) {
    const run=spawnSync('python3',['scripts/stellar/generate.py','--check'],
      {cwd:root,encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    assert.equal(run.status,0,`${run.error??''}\n${run.stdout}\n${run.stderr}`);
    assert.equal(JSON.parse(run.stdout).ok,true);
  }
});

test('existing catalog/public assets, original types/loader and archived original generator remain byte-for-byte unchanged', () => {
  assert.equal(sha(catalogBytes),'d7ff593765bcbe4a5f30befac1b1d08d520e256212d117c18f156f8177021e47');
  const before=JSON.parse(read('../test-data/stellar-model/protected-before.json').toString());
  for (const [path,expected] of Object.entries(before)) {
    // Packaging changed only generator I/O. Keep its original hash assertion on
    // the exact archived source; the tests above still reproduce current output.
    const retained = path === 'scripts/spacecatalog/generate.py'
      ? '../test-data/stellar-model/spacecatalog-generator-original.py' : path;
    assert.equal(sha(read(retained)),expected,path);
  }
});
