import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WristEngineObservation } from '../models/wristEngine.types';
import type { ForearmContour } from '../models/wrist.types';
import { WristTrackingEngineV2 } from '../services/engine/WristTrackingEngineV2';
import { cross, dot, length, rotate, sub, project, add, mul } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import { matchesPocFrame } from '../views/debug/wristEngineDebug';
import * as THREE from 'three';
import { configureCamera } from '../views/rendering/braceletModel';
import { analyzeWrist } from '../services/geometry/wristGeometry';
import { measureWristAnchorContour } from '../services/engine/wristAnchorContour';
import { measureForearmContour } from '../services/live/liveForearmContour';
import { registerWristAnchor } from '../services/engine/wristAnchorRegistration';

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
test('V2 refuses extrapolation outside observed boundary support', () => {
  const o = observation(); o.contour = contour(.38, .55);
  const r = new WristTrackingEngineV2().update(o);
  assert.equal(r.anchorState, 'ESTIMATED'); assert.equal(r.anchorExtrapolated, false); assert.deepEqual(r.anchor, r.hand0);
  assert.equal(r.wearCenter, null);
});
test('V2 does not extrapolate a centerline arbitrarily far', () => {
  const o = observation(); o.contour = contour(.6, .65);
  const r = new WristTrackingEngineV2().update(o);
  assert.deepEqual(r.anchor, r.hand0); assert.equal(r.anchorState, 'ESTIMATED');
  assert.equal(r.anchorReason, 'wrist-plane-not-bracketed');
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
  const o = observation(), c = contour();
  const turn = (p: { x: number; y: number }) => ({ x: .5 + (p.y - .3375), y: .3375 - (p.x - .5) });
  o.contour = { ...c, direction: { x: 1, y: 0 }, line: c.line!.map(turn) as [{ x: number; y: number }, { x: number; y: number }],
    sections: c.sections.map(s => ({ ...s, center: turn(s.center), left: turn(s.left), right: turn(s.right) })) };
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

test('regression: remote forearm centerline must not drag the local wrist anchor', () => {
  const o = observation(), c = contour();
  // Local wrist edges remain at x=.47/.57; the distant forearm curves away.
  c.sections = c.sections.map((s, i) => i < 3 ? s : {
    ...s, center: { ...s.center, x: s.center.x + .12 },
    left: { ...s.left, x: s.left.x + .12 }, right: { ...s.right, x: s.right.x + .12 },
  });
  c.line = [{ x: .52, y: .30 }, { x: .64, y: .55 }];
  c.direction = { x: .12 / Math.hypot(.12, .25), y: .25 / Math.hypot(.12, .25) };
  o.contour = c;
  const r = new WristTrackingEngineV2().update(o);
  assert.ok(r.anchor && Math.abs(r.anchor.x - .52) < 1e-10, 'use bracketing wrist edges, not the global line');
  assert.ok(Math.abs(r.anchor.y - .3375) < 1e-10, 'preserve Hand0 longitudinal station');
});

test('regression: unsupported contour extrapolation must leave Hand0 as an unconfirmed reference', () => {
  const o = observation(); o.contour = contour(.38, .55);
  const r = new WristTrackingEngineV2().update(o);
  assert.deepEqual(r.anchor, r.hand0);
  assert.equal(r.anchorExtrapolated, false);
  assert.equal(r.anchorState, 'ESTIMATED');
});

test('regression: off-center pitched forearm must round-trip to the observed image tangent', () => {
  const o = observation();
  o.hand = o.hand.map(p => ({ ...p, x: p.x + .20, y: p.y + .08 }));
  o.pose = o.pose.map((p, i) => i === 13 || i === 15 ? { ...p, x: p.x + .20, y: p.y + .08 } : p);
  o.poseWorld = o.poseWorld.map((p, i) => i === 13 ? { ...p, z: p.z! + .15 } : p);
  const r = new WristTrackingEngineV2().update(o); assert.ok(r.axis3D && r.anchor);
  const start = { x: r.anchor.x - .5, y: r.anchor.y - .375, z: r.focal };
  const a = project(start, { focal: r.focal, aspect: .75 });
  const b = project(add(start, mul(r.axis3D, .05)), { focal: r.focal, aspect: .75 });
  assert.ok(Math.abs(b.x - a.x) < 1e-10, 'vertical Pose in image must remain vertical after perspective projection');
  assert.ok(b.y > a.y);
});

test('regression: overlay must not use an equally sized newer video or expired received result', () => {
  const p = new WristTrackingEngineV2().update(observation());
  const meta = { isInferenceImage: true, receivedAt: 120, frameId: p.frameId };
  assert.equal(matchesPocFrame(p, 100, 200, 640, 480, false, meta), true);
  assert.equal(matchesPocFrame(p, 100, 200, 640, 480, false, { ...meta, isInferenceImage: false }), false);
  assert.equal(matchesPocFrame(p, 100, 700, 640, 480, false, meta), false);
  assert.equal(matchesPocFrame(p, 100, 200, 640, 480, false, { ...meta, frameId: p.frameId + 1 }), false);
});

test('V2 trace contains raw evidence and unfiltered anchor without implying smoothing', () => {
  const o = observation(); o.contour = contour();
  const r = new WristTrackingEngineV2().update(o);
  const trace = JSON.parse(JSON.stringify(r));
  assert.deepEqual(trace.traceInput.hand, o.hand);
  assert.deepEqual(trace.traceInput.handWorld, o.handWorld);
  assert.deepEqual(trace.traceInput.pose, o.pose);
  assert.deepEqual(trace.traceInput.poseWorld, o.poseWorld);
  assert.deepEqual(trace.traceInput.contour, o.contour);
  assert.deepEqual(trace.rawAnchor, trace.filteredAnchor);
  assert.equal(trace.filterApplied, false);
});

test('V2 local pixel scan covers the Hand0 plane on translated ROI at several angles/distances', () => {
  // Synthetic labeled silhouette, NOT a real webcam accuracy test.
  for (const degrees of [0, 20, 45, 90]) for (const scale of [1.6, 2.2]) for (const bentHand of [false, true]) {
    const angle = degrees * Math.PI / 180, h = handFixture({ roll: bentHand ? 0 : angle, scale });
    const pose = analyzeWrist(h.points, h.world, h.aspect, 'Right', { mode: 'straight-wrist', deferAxialCheck: true }).pose;
    assert.ok(pose);
    const W = 640, H = 480, x = 120, y = 70, width = 400, height = 370;
    const data = new Uint8ClampedArray(width * height * 4);
    const h0 = { x: h.points[0].x, y: h.points[0].y * h.aspect };
    const along = { x: -Math.sin(angle), y: Math.cos(angle) }, across = { x: along.y, y: -along.x };
    const palmSpan = Math.hypot(...[0, 1].map(dim => {
      const key = dim === 0 ? 'x' : 'y';
      return [5, 9, 13, 17].reduce((s, i) => s + (h.points[i][key] - h.points[0][key]) / 4 * (dim === 0 ? 1 : h.aspect), 0);
    }) as [number, number]);
    const offset = palmSpan * .06;
    for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
      const dx = (col + x) / W - h0.x, dy = (row + y) / W - h0.y;
      const a = dx * along.x + dy * along.y, t = dx * across.x + dy * across.y;
      const inside = Math.abs(t - offset) < palmSpan * .4 && a > -palmSpan * .5 && a < palmSpan * 1.3;
      data.set(inside ? [185, 126, 99, 255] : [234, 235, 237, 255], (row * width + col) * 4);
    }
    const roi = { x, y, width, height, imageWidth: W, imageHeight: H, data };
    const arm = bentHand ? Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 })) : [];
    if (bentHand) {
      arm[15] = { ...h.points[0], visibility: .95 };
      arm[13] = { x: arm[15].x + along.x * .25, y: arm[15].y + along.y * .25 / h.aspect, z: 0, visibility: .95 };
    }
    const local = measureWristAnchorContour(roi, pose, h.points, arm);
    assert.equal(local?.searchSource, bentHand ? 'Pose-image-search-prior' : 'Hand-search-prior');
    assert.ok(local?.contour.direction, `${degrees}/${scale}: local contour available`);
    const registered = registerWristAnchor(h0, local.contour);
    assert.equal(registered.observed, true, `${degrees}/${scale}: ${registered.reason}`);
    const expected = { x: h0.x + across.x * offset, y: h0.y + across.y * offset };
    assert.ok(Math.hypot(registered.anchor.x - expected.x, registered.anchor.y - expected.y) * W < 2, 'within 2 pixels of independent synthetic skin midpoint');
    const v1 = measureForearmContour(roi, pose, h.points[0]);
    assert.ok(v1.sections.every(s => s.along >= .08), 'default V1 sampling unchanged');
  }
});

test('V2 perspective axis round-trip at off-center positions, pitch, palm roll and distances', () => {
  // Independent Three camera generates the observed elbow projection. These are
  // controlled geometry cases, not measurements of anatomical webcam accuracy.
  const focal = 1.35, aspect = .75, camera = new THREE.PerspectiveCamera();
  configureCamera(camera, focal, aspect); camera.updateMatrixWorld();
  for (const degrees of [0, 20, 45, 90]) for (const palmRoll of [0, 45, 90, 180]) for (const pitch of [-45, 0, 45]) for (const distance of [.8, 1.2]) for (const x of [.35, .65]) {
    const angle = degrees * Math.PI / 180, pitchRad = pitch * Math.PI / 180;
    const h = handFixture({ x, roll: angle, twist: palmRoll * Math.PI / 180, scale: 2 * distance });
    const o = observation(); o.hand = h.points; o.handWorld = h.world;
    const expected = { x: -Math.sin(angle) * Math.cos(pitchRad), y: Math.cos(angle) * Math.cos(pitchRad), z: Math.sin(pitchRad) };
    const C = { x: x - .5, y: h.points[0].y * aspect - aspect / 2, z: focal };
    const elbow = add(C, mul(expected, .3 * distance));
    const projected = new THREE.Vector3(elbow.x, -elbow.y, -elbow.z).project(camera);
    const pose = o.pose.map(p => ({ ...p })), world = o.poseWorld.map(p => ({ ...p }));
    pose[15] = { ...h.points[0], visibility: .95 };
    pose[13] = { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, z: 0, visibility: .95 };
    world[13] = { ...add(world[15] as { x: number; y: number; z: number }, mul(expected, .25)), visibility: .95 };
    o.pose = pose; o.poseWorld = world;
    const r = new WristTrackingEngineV2().update(o);
    if (pose[13].x < .01 || pose[13].x > .99 || pose[13].y < .01 || pose[13].y > .99) {
      assert.equal(r.orientationState, 'UNCONFIRMED', 'an offscreen elbow must not be confirmed'); continue;
    }
    assert.ok(r.orientation && r.axis3D, `${degrees}/${palmRoll}/${pitch}/${distance}/${x}: ${r.reason}`);
    assert.ok(length(sub(r.axis3D, expected)) < 1e-10, 'recover the independently projected forearm axis');
    assert.ok(length(sub(rotate(r.orientation, { x: 0, y: 0, z: 1 }), expected)) < 1e-10);
  }
});
