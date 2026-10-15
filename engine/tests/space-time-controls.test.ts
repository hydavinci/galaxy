import test from 'node:test';
import assert from 'node:assert/strict';
import {SPACE_TIME_SPEEDS,FORWARD_TIME_SPEEDS,nextSpaceTimeSpeed,spaceTimeText,spaceTimeDescription} from '../src/space/time-controls';
import {ObservationClock,MIN_DATE,MAX_DATE,nextSpeed as oldStep} from '../src/observer/controls';
test('old three-order jumps reproduced, spatial fine steps start 1→2→5→10 with retained endpoints',()=>{
 assert.equal(oldStep(1,1),60);assert.equal(oldStep(60,1),3600);assert.equal(oldStep(3600,1),86400);
 let n=1;const steps=[];for(let i=0;i<5;i++){n=nextSpaceTimeSpeed(n,1);steps.push(n);}assert.deepEqual(steps,[2,5,10,20,30]);
 assert.equal(nextSpaceTimeSpeed(86400,1),86400);assert.equal(nextSpaceTimeSpeed(-86400,-1),-86400);
 for(let i=1;i<FORWARD_TIME_SPEEDS.length;i++)assert.ok(FORWARD_TIME_SPEEDS[i]/FORWARD_TIME_SPEEDS[i-1]<=3);
});
test('reverse rates are symmetric and one click traverses each fine preset through zero',()=>{
 let n=5;const reverse=[];for(let i=0;i<8;i++){n=nextSpaceTimeSpeed(n,-1);reverse.push(n);}assert.deepEqual(reverse,[2,1,0,-1,-2,-5,-10,-20]);
 for(let i=0;i<SPACE_TIME_SPEEDS.length-1;i++){assert.equal(nextSpaceTimeSpeed(SPACE_TIME_SPEEDS[i],1),SPACE_TIME_SPEEDS[i+1]);assert.equal(nextSpaceTimeSpeed(SPACE_TIME_SPEEDS[i+1],-1),SPACE_TIME_SPEEDS[i]);}
});
test('off-grid rates use directional nearest preset instead of jumping from a stale default index',()=>{
 assert.equal(nextSpaceTimeSpeed(7,1),10);assert.equal(nextSpaceTimeSpeed(7,-1),5);assert.equal(nextSpaceTimeSpeed(-7,1),-5);assert.equal(nextSpaceTimeSpeed(-7,-1),-10);assert.equal(nextSpaceTimeSpeed(.5,1),1);assert.equal(nextSpaceTimeSpeed(.5,-1),0);assert.equal(nextSpaceTimeSpeed(2,0),2);assert.equal(nextSpaceTimeSpeed(NaN,1),2);
});
test('playback speed is clearly labeled as exact multiplier with simulated time per real second',()=>{
 assert.equal(spaceTimeText(86400),'86,400×');assert.equal(spaceTimeText(-2),'−2×');assert.equal(spaceTimeText(0),'暂停');assert.equal(spaceTimeText(5),'5×');assert.match(spaceTimeDescription(86400),/前进1天/);assert.match(spaceTimeDescription(-3600),/倒退1小时/);assert.match(spaceTimeDescription(2),/前进2秒/);
});
test('finer presets retain actual clock advancement, pause/resume, date boundaries and Now',()=>{
 const c=new ObservationClock();c.setDate(new Date('2026-10-14T00:00:00Z'));const start=c.timestamp;c.setSpeed(nextSpaceTimeSpeed(c.speed,1));assert.equal(c.speed,1);c.setSpeed(nextSpaceTimeSpeed(c.speed,1));assert.equal(c.speed,2);c.tick(.5);assert.equal(c.timestamp-start,1000);
 c.togglePause();c.tick(1);assert.equal(c.timestamp-start,1000);c.togglePause();assert.equal(c.speed,2);c.setSpeed(-5);c.tick(1);assert.equal(c.timestamp-start,-4000);
 c.setDate(new Date(MAX_DATE));c.setSpeed(86400);c.tick(1);assert.equal(c.timestamp,MAX_DATE);assert.equal(c.speed,0);c.setDate(new Date(MIN_DATE));c.setSpeed(-86400);c.tick(1);assert.equal(c.timestamp,MIN_DATE);c.now();assert.equal(c.speed,1);assert.equal(c.live,true);
});
