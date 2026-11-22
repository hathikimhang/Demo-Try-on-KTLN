import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WristEngineObservation } from '../models/wristEngine.types';
import type { ForearmContour } from '../models/wrist.types';
import { WristTrackingEngineV2 } from '../services/engine/WristTrackingEngineV2';
import { cross, dot, length, rotate, sub } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import { matchesPocFrame } from '../views/debug/wristEngineDebug';
import * as THREE from 'three';
import { configureCamera } from '../views/rendering/braceletModel';

function observation(time = 100, angle = 0): WristEngineObservation {
  const h = handFixture({ roll: angle });
  const pose = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  const poseWorld = pose.map(p => ({ ...p }));
  pose[15] = { ...h.points[0], visibility: .95 };
  pose[13] = { x: pose[15].x - Math.sin(angle) * .25, y: pose[15].y + Math.cos(angle) * .25 / h.aspect, z: 0, visibility: .95 };
  poseWorld[15] = { x: 10, y: 20, z: 30, visibility: .95 };
  poseWorld[13] = { x: 10 - Math.sin(angle) * .25, y: 20 + Math.cos(angle) * .25, z: 30, visibility: .95 };
  return { frameId: time, timestamp: time, width: 640, height: 480, focal: 1.35, hand: h.points, handWorld: h.world, pose, poseWorld, contour: null };
}
function contour(y0 = .30, y1 = .55): ForearmContour {
  return { direction: { x: 0, y: 1 }, confidence: .99, source: 'contour-rgb', reason: 'fixture',
    line: [{ x: .52, y: y0 }, { x: .52, y: y1 }],
    sections: Array.from({ length: 6 }, (_, i) => {
      const y = y0 + (y1 - y0) * i / 5;
      return { center: { x: .52, y }, left: { x: .47, y }, right: { x: .57, y }, width: 64, along: i / 5 };
    }),
  };
}

test('V2 keeps Hand0, supported centerline anchor and unknown wear center distinct', () => {
  const o = observation(); o.contour = contour();
  const r = new WristTrackingEngineV2().update(o);
  assert.deepEqual(r.hand0, { x: .5, y: .45 * .75 });
  assert.equal(r.anchor?.x, .52); assert.equal(r.anchor?.y, r.hand0?.y);
  assert.equal(r.anchorState, 'OBSERVED'); assert.equal(r.anchorExtrapolated, false);
  assert.equal(r.wearCenter, null);
});
test('V2 labels extrapolation outside observed centerline support', () => {
  const o = observation(); o.contour = contour(.38, .55);
  const r = new WristTrackingEngineV2().update(o);
  assert.equal(r.anchorState, 'ESTIMATED'); assert.equal(r.anchorExtrapolated, true);
  assert.equal(r.wearCenter, null);
});
test('V2 does not extrapolate a centerline arbitrarily far', () => {
  const o = observation(); o.contour = contour(.6, .65);
  const r = new WristTrackingEngineV2().update(o);
  assert.deepEqual(r.anchor, r.hand0); assert.equal(r.anchorState, 'ESTIMATED');
  assert.equal(r.anchorReason, 'centerline-too-far-for-extrapolation');
});
test('V2 contour confidence never confirms depth or learns a fabricated 3D relationship', () => {
  const engine = new WristTrackingEngineV2();
  for (let t = 100; t < 16000; t += 100) {
    const o = observation(t); o.pose = []; o.poseWorld = []; o.contour = contour();
    const r = engine.update(o);
    assert.equal(r.confidence2D, .99); assert.equal(r.confidence3D, 0);
    assert.equal(r.orientationState, 'UNCONFIRMED'); assert.equal(r.orientation, null);
    assert.equal(r.axis3D, null); assert.equal(r.depthAgeMs, null);
  }
});
test('V2 loses 3D confirmation immediately when current Pose disappears; exposes evidence age', () => {
  const engine = new WristTrackingEngineV2();
  assert.equal(engine.update(observation()).orientationState, 'OBSERVED');
  const o = observation(200); o.pose = []; o.poseWorld = [];
  const r = engine.update(o);
  assert.equal(r.orientation, null); assert.equal(r.depthAgeMs, 100);
  assert.equal(r.orientationState, 'UNCONFIRMED');
});
test('V2 missing Hand is explicit, even if Pose exists', () => {
  const o = observation(); o.hand = [];
  const r = new WristTrackingEngineV2().update(o);
  assert.equal(r.anchor, null); assert.equal(r.orientation, null); assert.equal(r.reason, 'no-hand');
});
test('V2 rejects stale, out-of-order, invalid dimensions and nonfinite input', () => {
  const engine = new WristTrackingEngineV2();
  assert.equal(engine.update(observation(), 1101).reason, 'stale-frame');
  assert.equal(engine.update(observation()).orientationState, 'OBSERVED');
  assert.equal(engine.update(observation()).reason, 'out-of-order');
  assert.equal(engine.update({ ...observation(200), width: 0 }).reason, 'invalid-frame');
  assert.equal(engine.update({ ...observation(200), timestamp: NaN }).reason, 'invalid-frame');
});
test('V2 associates arms using image coordinates and rejects ambiguous bilateral match', () => {
  const o = observation();
  o.pose = o.pose.map((p, i) => i === 16 ? { ...o.pose[15] } : i === 14 ? { ...o.pose[13] } : p);
  o.poseWorld = o.poseWorld.map((p, i) => i === 16 ? { ...o.poseWorld[15] } : i === 14 ? { ...o.poseWorld[13] } : p);
  assert.equal(new WristTrackingEngineV2().update(o).reason, 'ambiguous-arm-match');
});
test('V2 rejects mismatched or low visibility Pose, rather than borrowing another arm', () => {
  const o = observation(); o.pose = o.pose.map((p, i) => i === 15 ? { ...p, x: .95 } : p);
  assert.equal(new WristTrackingEngineV2().update(o).reason, 'forearm-depth-unobserved');
  const low = observation(); low.poseWorld = low.poseWorld.map(p => ({ ...p, visibility: .2 }));
  assert.equal(new WristTrackingEngineV2().update(low).orientation, null);
  const cropped = observation(); cropped.pose = cropped.pose.map((p, i) => i === 13 ? { ...p, y: 1.1 } : p);
  assert.equal(new WristTrackingEngineV2().update(cropped).reason, 'forearm-depth-unobserved');
});
test('V2 is invariant to independent Hand/Pose world origins; does not mutate inputs', () => {
  const o = observation(), original = JSON.stringify(o);
  const shifted = { ...o, handWorld: o.handWorld.map(p => ({ ...p, x: p.x + 7, y: p.y - 4, z: p.z! + 11 })), poseWorld: o.poseWorld.map(p => ({ ...p, x: p.x - 9, y: p.y + 5, z: p.z! - 18 })) };
  const a = new WristTrackingEngineV2().update(o), b = new WristTrackingEngineV2().update(shifted);
  assert.ok(a.axis3D && b.axis3D && length(sub(a.axis3D, b.axis3D)) < 1e-10);
  assert.ok(a.orientation && b.orientation && Math.abs(dot(a.orientation, b.orientation) + a.orientation.w * b.orientation.w) > 1 - 1e-10);
  assert.equal(JSON.stringify(o), original);
});
test('V2 orthonormal frame and local Z follow current independent Pose at 0/20/45/90 degrees', () => {
  for (const deg of [0, 20, 45, 90]) {
    const r = new WristTrackingEngineV2().update(observation(100, deg * Math.PI / 180));
    assert.ok(r.orientation && r.axis3D, r.reason);
    const x = rotate(r.orientation, { x: 1, y: 0, z: 0 }), y = rotate(r.orientation, { x: 0, y: 1, z: 0 }), z = rotate(r.orientation, { x: 0, y: 0, z: 1 });
    assert.ok(Math.abs(dot(x, y)) < 1e-10 && Math.abs(length(x) - 1) < 1e-10);
    assert.ok(length(sub(cross(x, y), z)) < 1e-10);
    assert.ok(length(sub(z, r.axis3D)) < 1e-10);
    assert.ok(Math.abs(z.x + Math.sin(deg * Math.PI / 180)) < 1e-10);
  }
});
test('V2 quaternion sign continuity does not hold an old rotation', () => {
  const engine = new WristTrackingEngineV2(); let last = engine.update(observation()).orientation!;
  for (let deg = 30; deg <= 360; deg += 30) {
    const r = engine.update(observation(deg + 100, deg * Math.PI / 180)); assert.ok(r.orientation);
    assert.ok(dot(last, r.orientation) + last.w * r.orientation.w >= 0); last = r.orientation;
    const z = rotate(last, { x: 0, y: 0, z: 1 });
    assert.ok(Math.abs(z.x + Math.sin(deg * Math.PI / 180)) < 1e-10);
  }
});
test('V2 refuses disagreement between independent contour and Pose', () => {
  const o = observation(); o.contour = { ...contour(), direction: { x: 1, y: 0 } };
  assert.equal(new WristTrackingEngineV2().update(o).reason, 'pose-contour-disagreement');
});
test('V2 refuses singular local frame instead of transporting stale roll', () => {
  const o = observation(); const w = o.handWorld.map(p => ({ ...p }));
  w[5] = { x: 0, y: -.04, z: 0 }; w[17] = { x: 0, y: -.08, z: 0 }; o.handWorld = w;
  assert.equal(new WristTrackingEngineV2().update(o).orientation, null);
});
test('V2 overlay excludes newer video, held images, stale and mismatched dimensions', () => {
  const r = new WristTrackingEngineV2().update(observation());
  assert.equal(matchesPocFrame(r, 100, 200, 640, 480, false), true);
  assert.equal(matchesPocFrame(r, 101, 200, 640, 480, false), false);
  assert.equal(matchesPocFrame(r, 100, 200, 640, 480, true), false);
  assert.equal(matchesPocFrame(r, 100, 1101, 640, 480, false), false);
  assert.equal(matchesPocFrame(r, 100, 200, 1280, 960, false), false);
});

test('V2 raw image axes and CV coordinates project consistently through actual Three camera', () => {
  for (const [width, height] of [[1280, 720], [640, 720], [640, 480]]) {
    const o = { ...observation(), width, height, focal: 1.35 * Math.max(1, height / width) };
    const r = new WristTrackingEngineV2().update(o); assert.ok(r.anchor && r.orientation);
    const camera = new THREE.PerspectiveCamera(); configureCamera(camera, r.focal, height / width); camera.updateMatrixWorld();
    const start = { x: r.anchor.x - .5, y: r.anchor.y - height / width / 2, z: r.focal };
    const v = new THREE.Vector3(start.x, -start.y, -start.z).project(camera);
    assert.ok(Math.abs((v.x + 1) / 2 - r.anchor.x) < 1e-10);
    assert.ok(Math.abs((1 - v.y) / 2 * height / width - r.anchor.y) < 1e-10);
  }
});

test('V2 rejects inconsistent Hand image/world fit before confirming roll', () => {
  const o = observation(); o.hand = o.hand.map((p, i) => i === 5 ? { ...p, x: p.x + .15 } : p);
  assert.equal(new WristTrackingEngineV2().update(o).reason, 'hand-reprojection-inconsistent');
});
