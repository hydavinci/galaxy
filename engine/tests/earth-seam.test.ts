import test from 'node:test';
import assert from 'node:assert/strict';
import { EARTH_FRAGMENT_SHADER } from '../src/observer/earth-inspector';

test('Earth periodic longitude uses explicit wrapped derivatives instead of implicit coarse mip selection',()=>{
 assert.match(EARTH_FRAGMENT_SHADER,/dFdx\(uv\)/);
 assert.match(EARTH_FRAGMENT_SHADER,/dFdy\(uv\)/);
 assert.match(EARTH_FRAGMENT_SHADER,/uvDx\.x\s*-=\s*round\(uvDx\.x\)/);
 assert.match(EARTH_FRAGMENT_SHADER,/uvDy\.x\s*-=\s*round\(uvDy\.x\)/);
 assert.match(EARTH_FRAGMENT_SHADER,/textureGrad\(uDaymap,\s*uv,\s*uvDx,\s*uvDy\)/);
 assert.doesNotMatch(EARTH_FRAGMENT_SHADER,/\btexture\(uDaymap,/);
 // The dateline finite difference must represent adjacent geographic texels,
 // not nearly a whole texture. Only periodic longitude wraps, not latitude.
 for(const [left,right,expected] of [[.999,.001,.002],[.001,.999,-.002],[.4,.401,.001]]){
  const difference=right-left,shortest=difference-Math.round(difference);
  assert.ok(Math.abs(shortest-expected)<1e-12);
 }
 assert.doesNotMatch(EARTH_FRAGMENT_SHADER,/uvD[xy]\.y\s*-=\s*round/);
});
