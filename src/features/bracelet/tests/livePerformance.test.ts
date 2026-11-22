import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveForeground } from '../services/measurement/foregroundClassifier';
import { LiveFrameGate, LiveFrameClock } from '../services/live/liveFrameClock';
import { LivePerformance } from '../services/diagnostics/livePerformance';
import { handFixture } from './fixtures/wristFixtures';
import { estimateWrist } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { liveSkinInterval } from '../services/live/liveTaskBudget';
const legacy = (p: number[] | null, b: number[][], t: number) => p && Math.min(...b.map(v=>Math.hypot(...p.map((x,i)=>x-v[i])))) > t ? 255 : 0;

test('Live fast foreground is exactly the existing mask predicate, including threshold equality and duplicate prototypes', () => {
  const backgrounds = [[10,20,30,40],[10,20,30,40],[40,30,20,10],[10,20,30,40]];
  for (const threshold of [0, 5, 14.999999, 15, 15.000001, 80]) {
    const classify = liveForeground(backgrounds, threshold);
    for (let i=0;i<600;i++) { const p = [i%256,(i*19)%256,(i*73)%256,(i*31)%256]; assert.equal(classify(p),legacy(p,backgrounds,threshold)); }
    assert.equal(classify(null),0); assert.equal(classify([25,20,30,40]),legacy([25,20,30,40],backgrounds,threshold));
  }
});

test('Fast foreground preserves invalid/minimum-distance semantics and never quantizes background colors', () => {
  for (const bg of [[], [[0,0,0,0]], [[0,0,0,0],[0,0,0,NaN]], [[0,0,0,0],[.000001,0,0,0]]]) {
    for (const t of [0,.000001,Infinity,NaN]) for(const p of [null,[0,0,0,0],[1,2,3,4],[NaN,0,0,0]]) assert.equal(liveForeground(bg,t)(p),legacy(p,bg,t));
  }
});

test('Frame gate never queues busy frames or runs inference twice for one decoded frame', () => {
  const gate = new LiveFrameGate();
  assert.equal(gate.observe(1,false),'ready'); assert.equal(gate.observe(1,false),'duplicate');
  assert.equal(gate.observe(2,true),'busy'); assert.equal(gate.observe(2.5,true),'busy');
  assert.equal(gate.observe(2,false),'duplicate'); assert.equal(gate.observe(2.5,false),'ready'); assert.equal(gate.observe(2.5,false),'duplicate');
  assert.equal(gate.observe(3,false),'ready'); assert.equal(gate.observe(2.5,false),'duplicate'); assert.equal(gate.observe(NaN,false),'duplicate');
  gate.reset(); assert.equal(gate.observe(1,false),'ready');
});

test('Native video callback clock cancels at stop, including stop inside a callback', () => {
  let callback: VideoFrameRequestCallback | undefined, requested=0, cancelled=0;
  const video={requestVideoFrameCallback(cb:VideoFrameRequestCallback){ callback=cb;return ++requested; }, cancelVideoFrameCallback(){cancelled++;}} as unknown as HTMLVideoElement;
  const clock=new LiveFrameClock(); let frames=0;
  clock.start(video,frame=>{frames++;assert.equal(frame.mediaTime,1);clock.stop();});
  callback!(1000,{mediaTime:1,presentedFrames:1} as VideoFrameCallbackMetadata);
  assert.equal(frames,1);assert.equal(requested,1);assert.equal(cancelled,1);
  callback!(1010,{mediaTime:2} as VideoFrameCallbackMetadata);assert.equal(frames,1);
});

test('RAF fallback clock is cancellable and supplies current mediaTime without inventing camera FPS', () => {
  const oldRAF=globalThis.requestAnimationFrame, oldCancel=globalThis.cancelAnimationFrame;let cb:FrameRequestCallback|undefined,cancelled=0;
  globalThis.requestAnimationFrame=(f)=>{cb=f;return 7;};globalThis.cancelAnimationFrame=()=>{cancelled++;};
  try { const clock=new LiveFrameClock(), video={currentTime:1.25} as HTMLVideoElement;
    clock.start(video,frame=>{assert.equal(frame.mediaTime,1.25);assert.equal(frame.presentedFrames,undefined);clock.stop();});cb!(1000);assert.equal(cancelled,1);
  } finally {globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;}
});

test('A queued callback from a stopped generation cannot revive a second acquisition loop after restart', () => {
  const callbacks:VideoFrameRequestCallback[]=[];let observed=0;
  const video={requestVideoFrameCallback(cb:VideoFrameRequestCallback){callbacks.push(cb);return callbacks.length;},cancelVideoFrameCallback(){}} as unknown as HTMLVideoElement;
  const clock=new LiveFrameClock();clock.start(video,()=>observed++);clock.stop();clock.start(video,()=>observed++);
  callbacks[0](1000,{mediaTime:1} as VideoFrameCallbackMetadata);assert.equal(observed,0);assert.equal(callbacks.length,2);
  callbacks[1](1033,{mediaTime:2} as VideoFrameCallbackMetadata);assert.equal(observed,1);assert.equal(callbacks.length,3);clock.stop();
});

test('Performance telemetry distinguishes observed camera, inference, GL and composite rates', () => {
  const p=new LivePerformance();p.reset(1000);
  p.camera(1100,5);p.camera(1200,7);p.request(1200);p.result(1250,25);p.add('composite',1260);p.add('webgl',1260);p.add('composite',1300);
  const s=p.snapshot(2000);assert.equal(s.cameraFPS,3);assert.equal(s.inferenceFPS,1);assert.equal(s.webglFPS,1);assert.equal(s.compositeFPS,2);assert.equal(s.pendingRequests,0);assert.equal(s.maxPendingRequests,1);assert.equal(s.droppedCameraFrames,2);
  assert.equal((s.inferenceMs as {mean:number}).mean,25);assert.equal(p.snapshot(5000).inferenceFPS,0);
});

test('Pose delta and state transitions are bounded debug observations, with no ability to modify a tracking pose', () => {
  const f=handFixture(), pose=estimateWrist(f.points,f.world,f.aspect,'',{mode:'straight-wrist'})!;assert.ok(pose);
  const p=new LivePerformance();p.reset(1000);const before=JSON.stringify(pose);
  p.pose(1000,pose,'ACQUIRING',640);p.pose(1050,pose,'TRACKING',640);
  const flipped:WristPose={...pose,orientation:{x:-pose.orientation.x,y:-pose.orientation.y,z:-pose.orientation.z,w:-pose.orientation.w}};
  p.pose(1100,flipped,'TRACKING',640);const s=p.snapshot(1500);
  assert.ok((s.angularDeltaRadians as {max:number}).max<1e-7);assert.equal((s.centerDeltaPx as {max:number}).max,0);assert.equal((s.logScaleDelta as {max:number}).max,0);assert.equal(p.transitions.length,1);assert.equal(JSON.stringify(pose),before);
  for(let i=0;i<1000;i++){p.pose(2000+i,null,i%2?'LOST':'ACQUIRING',640);p.add('renderMs',2000+i,1);}
  assert.equal(p.transitions.length,100);assert.ok((p.snapshot(3000).renderMs as {count:number}).count<=400);
});

test('Optional segmentation budgets measured cost only when edges are reliable; uncertainty restores original cadence', () => {
  assert.equal(liveSkinInterval(null,true),450);assert.equal(liveSkinInterval(140,true),1400);assert.equal(liveSkinInterval(5,true),450);assert.equal(liveSkinInterval(500,true),2000);
  assert.equal(liveSkinInterval(140,false),450);assert.equal(liveSkinInterval(NaN,true),450);assert.equal(liveSkinInterval(-1,true),450);
});
