import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getStellarModel, stellarBody } from '../../src/space/stellar-model';
import type { CatalogStar3D } from '../../src/space/types';

const root=new URL('../../',import.meta.url), reports=new URL('test-results/stellar-model/',root);
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--check'&&arg!=='--report')||(args.includes('--check')&&args.includes('--report')))
  throw new Error('Usage: verify.ts [--check | --report]; --check is read-only');
const writeReports=args.includes('--report');
const read=(path:string)=>readFileSync(new URL(path,root));
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const stars:CatalogStar3D[]=JSON.parse(read('public/data/space-stars.json').toString()).stars;
const generated=JSON.parse(read('../test-data/stellar-model/generation.json').toString());
const protectedBefore=JSON.parse(read('../test-data/stellar-model/protected-before.json').toString());
const preserved=Object.entries(protectedBefore).map(([path,hash])=>{
  const retained=path==='scripts/spacecatalog/generate.py'
    ? '../test-data/stellar-model/spacecatalog-generator-original.py' : path;
  const actual=sha(read(retained));return {path,retained,sha256:actual,unchanged:actual===hash};
});
const started=performance.now();
const samples=stars.map(star=>({star,model:getStellarModel(star),body:stellarBody(star)}));
const coldCoverageMs=performance.now()-started;
const models=samples.map(({model})=>model).filter(model=>model!==null);
const count=(predicate:(item:typeof models[number])=>boolean)=>models.filter(predicate).length;
const names=['Scheat','Sirius','Proxima Centauri','Vega','Capella'];
const anchors=samples.filter(({star})=>names.includes(star.name)).map(({star,model})=>({id:star.id,name:star.name,
  sourceId:star.sourceId,positionAU:star.positionAU,model}));
const fields=['radiusKm','temperatureK','luminositySolar'] as const;
const ranges=Object.fromEntries(fields.map(field=>[field,{min:Math.min(...models.map(m=>m[field])),max:Math.max(...models.map(m=>m[field]))}]));
const allChecks={
  catalogCount:stars.length===9078,
  completeCoverage:models.length===9078,
  allFinitePositive:models.every(m=>fields.every(f=>Number.isFinite(m[f])&&m[f]>0)),
  boundedColorsAndSeeds:models.every(m=>m.color.every(c=>Number.isFinite(c)&&c>=0&&c<=1)&&m.seed>=0&&m.seed<=1),
  referenceTemperatureCount:count(m=>!m.estimatedTemperature)===4,
  referenceRadiusCount:count(m=>!m.estimatedRadius)===3,
  allLuminositiesEstimated:count(m=>m.estimatedLuminosity)===9078,
  adaptersPreservePositionIdentity:samples.every(({star,body})=>body?.positionAU===star.positionAU&&body.id===star.id&&body.textureId===''),
  stableCaches:samples.every(({star,body,model})=>stellarBody(star)===body&&getStellarModel(star)===model),
  oldPublicAndSourcePreserved:preserved.every(item=>item.unchanged),
};
const summary={status:Object.values(allChecks).every(Boolean)?'PASS':'FAIL',scope:'stellar model/metadata only; no final build, native rendering or publication',
  checks:allChecks,source:generated,coverage:{supported:models.length,unsupported:stars.length-models.length,
  referenceRadii:count(m=>!m.estimatedRadius),estimatedRadii:count(m=>m.estimatedRadius),
  referenceTemperatures:count(m=>!m.estimatedTemperature),estimatedTemperatures:count(m=>m.estimatedTemperature),
  estimatedBolometricLuminosities:count(m=>m.estimatedLuminosity),disclosedBoundaryFallbacks:count(m=>/降级/.test(m.temperatureSource)),
  hipCrossIds:count(m=>m.hipNumber!==undefined),rawSpectra:count(m=>m.spectralType!==null)},
  measurements:{coldModelAndAdapterCoverageMs:coldCoverageMs,note:'Node CPU sample only, not browser startup or frame rate'},
  ranges,anchors,preservation:{checkedFiles:preserved.length,unchanged:preserved.filter(item=>item.unchanged).length},
  api:{module:'src/space/stellar-model.ts',exports:['getStellarModel','stellarBody'],additionalField:'hipNumber?: number',
  unsupportedPolicy:'null unless an existing retained HYG ID/source ID and its exact published B-V/Mv match; invalid positions fail closed',
  colorSemantics:'normalized gamma-compressed Planck 650/550/450 nm display tint (not linear/radiometric RGB)',
  bodyPolicy:'original ID/position array, empty textureId, no snapshot insertion, illustrative inertial axes'},
  tests:{focusedFile:'engine/tests/stellar-model.test.ts',note:'Run npm test and npm run typecheck separately; this verifier does not run either.'},
};
if(writeReports){
  mkdirSync(reports,{recursive:true});
  writeFileSync(new URL('SUMMARY.json',reports),JSON.stringify(summary,null,2)+'\n');
  writeFileSync(new URL('preservation.json',reports),JSON.stringify(preserved,null,2)+'\n');
}
console.log(JSON.stringify({status:summary.status,coverage:summary.coverage,ranges,reports:writeReports?fileURLToPath(reports):null}));
if(summary.status!=='PASS')process.exitCode=1;
