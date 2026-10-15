import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFileSync, readdirSync, lstatSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const engine=fileURLToPath(new URL('../',import.meta.url));
const fixtures=fileURLToPath(new URL('../../test-data/',import.meta.url));
const hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const manifest=JSON.parse(readFileSync(join(fixtures,'manifest.json'),'utf8'));
function snapshot(directory:string):Record<string,string>{
  const result:Record<string,string>={};
  function visit(path:string,relative=''){
    for(const name of readdirSync(path).sort()){
      const file=join(path,name),key=relative+name,stat=lstatSync(file);
      assert.equal(stat.isSymbolicLink(),false,`fixtures must be regular files: ${key}`);
      if(stat.isDirectory())visit(file,key+'/');
      else result[key]=hash(readFileSync(file));
    }
  }
  visit(directory);return result;
}

test('curated scientific fixtures are hash-pinned regular files; gzip preserves the complete original HYG bytes',()=>{
  snapshot(fixtures);
  for(const [name,entry] of Object.entries(manifest.files) as [string,any][]){
    const bytes=readFileSync(join(fixtures,name));
    assert.equal(bytes.length,entry.bytes,name);
    assert.equal(hash(bytes),entry.sha256,name);
    if(entry.decompressedSha256){
      const original=gunzipSync(bytes,{maxOutputLength:entry.decompressedBytes+1});
      assert.equal(original.length,entry.decompressedBytes);
      assert.equal(hash(original),entry.decompressedSha256);
      assert.equal(hash(original),entry.sourceSnapshotSha256);
    }
    if(entry.scientificLegendSha256){
      const legend=bytes.toString('utf8').split(/(?<=\n)/).find(line=>line.startsWith(' Geometric state vectors have NO corrections'));
      assert.ok(legend,name);assert.equal(hash(legend),entry.scientificLegendSha256,name);
    }
    if(entry.scientificBlockSha256){
      const text=bytes.toString('utf8'),start=text.indexOf('$$SOE'),end=text.indexOf('$$EOE')+5;
      assert.ok(start>=0&&end>start,name);
      assert.equal(hash(text.slice(start,end)),entry.scientificBlockSha256,name);
    }
  }
});

test('published source fixtures contain no private fetch wrappers, request IDs, local host paths or contact-email metadata',()=>{
  for(const name of Object.keys(manifest.files)){
    if(name.endsWith('.gz'))continue;
    const text=readFileSync(join(fixtures,name),'utf8');
    assert.doesNotMatch(text,/EXTERNAL_UNTRUSTED_CONTENT|Source: Web Fetch|\/home\/|\/tmp\//,name);
    assert.doesNotMatch(text,/[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/,name);
  }
});

test('all three offline generator checks reproduce outputs without modifying fixtures or generated assets',()=>{
  const before=snapshot(fixtures);
  const paths=['public/data/space-stars.json','public/data/space-stars-credits.json',
    'src/space/stellar-metadata.json','public/data/stellar-model-credits.json',
    ...Array.from({length:5},(_,i)=>`public/data/stars-lod${i}.bin`)];
  const generated=paths.map(path=>hash(readFileSync(join(engine,path))));
  for(const script of ['scripts/spacecatalog/generate.py','scripts/stellar/generate.py','scripts/generate-lod.py']){
    const run=spawnSync('python3',[join(engine,script),'--check'],{
      cwd:tmpdir(),encoding:'utf8',timeout:30000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},
    });
    assert.equal(run.status,0,`${script}: ${run.error??''}\n${run.stdout}\n${run.stderr}`);
  }
  assert.deepEqual(snapshot(fixtures),before);
  assert.deepEqual(paths.map(path=>hash(readFileSync(join(engine,path)))),generated);
});

test('pre-build guard accepts isolated output and refuses live or dangling symlinks without writes',()=>{
  const directory=mkdtempSync(join(tmpdir(),'galaxy build guard '));
  try{
    mkdirSync(join(directory,'scripts'));
    const script=join(directory,'scripts/check-build-output.mjs');
    writeFileSync(script,readFileSync(join(engine,'scripts/check-build-output.mjs')));
    const run=()=>spawnSync(process.execPath,[script],{cwd:tmpdir(),encoding:'utf8',timeout:10000});
    assert.equal(run().status,0,'absent isolated dist');
    assert.equal(readdirSync(directory).includes('dist'),false,'guard must not create output');
    mkdirSync(join(directory,'dist'));
    writeFileSync(join(directory,'dist/marker'),'keep');
    assert.equal(run().status,0,'ordinary isolated dist');
    assert.equal(readFileSync(join(directory,'dist/marker'),'utf8'),'keep');
    rmSync(join(directory,'dist'),{recursive:true});
    mkdirSync(join(directory,'target'));writeFileSync(join(directory,'target/marker'),'live');
    symlinkSync(join(directory,'target'),join(directory,'dist'),'dir');
    assert.equal(run().status,1,'symlink to existing release is refused');
    assert.equal(readFileSync(join(directory,'target/marker'),'utf8'),'live');
    rmSync(join(directory,'dist'));
    symlinkSync(join(directory,'missing-target'),join(directory,'dist'),'dir');
    assert.equal(run().status,1,'dangling symlink is also refused');
    assert.equal(lstatSync(join(directory,'dist')).isSymbolicLink(),true);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
