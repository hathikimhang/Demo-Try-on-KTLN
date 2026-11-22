import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { handFixture } from './testing/wristFixtures';
import { estimateWrist, project, quaternionAngle, rotate, type WristPose } from './wristGeometry';
import { projectedWidth, sizingDebug, WristSizer, type WidthMeasurement } from './braceletSizing';
import { BANGLE, BANGLE_INNER_RADIUS, FOREARM, WRIST_MODEL_RADIUS } from './braceletDimensions';
import { LiveWristSizer } from './liveWristSizing';
import { LiveWristFilter, LiveWristSession, LiveWristPlacement } from './liveWristTracking';
import { applyCameraPose, createBraceletObjects, disposeObjects } from './braceletModel';
import { WristRoiTracker } from './wristRoiTracking';

function pose(options: Parameters<typeof handFixture>[0] = {}) {
  const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }); assert.ok(p); return p;
}
const absent: WidthMeasurement = { width: null, confidence: 0, reason: 'boundary unavailable' };
const measured = (p: WristPose, radius = p.radius * 1.5): WidthMeasurement => ({ width: projectedWidth(p, radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .95, sampleCount: 9, reason: 'controlled native silhouette' });
function acquire(s: LiveWristSizer, p = pose(), m = measured(p)) {
  s.update(p, m, 1000); s.update(p, m, 1050); const fit = s.update(p, m, 1100); assert.ok(fit.pose); return fit.pose;
}
test('Live rejects anatomical prior as measurement, and acquires real width independently of prior radius', () => {
  const s = new LiveWristSizer(), p = pose(); assert.equal(s.update(p, absent, 950).pose, null);
  const knownRadius = p.radius * 1.5, acquired = acquire(s, { ...p, radius: p.radius * .5 }, measured(p, knownRadius));
  assert.ok(Math.abs(acquired.radius / knownRadius - 1) < 1e-7);
});
test('Reproduces frozen wrong first fit; new Live size recovers through repeated trusted observations with a bounded rate', () => {
  const p = pose(), known = p.radius * 1.5, bad = measured(p, known * .6), good = measured(p, known);
  const old = new WristSizer(); for (const t of [1000, 1050, 1100]) old.update(p, bad, t, { video: true });
  assert.ok(Math.abs(old.update(p, good, 1150, { video: true }).pose!.radius / known - .6) < 1e-7);
  const s = new LiveWristSizer(); let before = acquire(s, p, bad);
  for (let i = 1; i <= 200; i++) { const next = s.update(p, good, 1100 + i * 50).pose!; assert.ok(Math.abs(Math.log(next.radius / before.radius)) <= .18 * .05 + 1e-9); before = next; }
  assert.ok(Math.abs(before.radius / known - 1) < 1e-6);
});
test('Sparse segmentation samples can acquire across intervening weak measurements, but cannot span an unbounded gap', () => {
  const p = pose(), s = new LiveWristSizer(); let fit;
  for (let i = 0; i <= 18; i++) fit = s.update(p, i % 9 === 0 ? measured(p) : absent, 1000 + i * 50);
  assert.ok(fit!.pose);
  const next = new LiveWristSizer(); next.update(p, measured(p), 1000);
  for (let i = 1; i < 40; i++) next.update(p, absent, 1000 + i * 50);
  assert.equal(next.update(p, measured(p), 3000).pose, null);
});
test('180° twist does not reinterpret the same 2D width as a larger physical wrist; handedness noise cannot clear calibration', () => {
  const first = pose(), s = new LiveWristSizer(), fitted = acquire(s, first), width = measured(first);
  for (let i = 1; i <= 120; i++) {
    const p = { ...pose({ twist: i * Math.PI / 120 }), handedness: i % 2 ? 'Left' : 'Right' };
    const fit = s.update(p, width, 1100 + i * 33); assert.ok(fit.pose);
    // Small corrections near the reference view are intentional; unlike
    // independent per-angle inverse fitting, drift stays below 1.5% here.
    assert.ok(Math.abs(fit.pose.calibrationRadius! / fitted.calibrationRadius! - 1) < .015, 'no rotation-induced radius inflation');
  }
});
test('Near/far projection uses distance once, with no fixed pixel size or accumulating manual scale', () => {
  const s = new LiveWristSizer(), p = pose(), first = acquire(s, p), model = createBraceletObjects();
  let nearWidth = 0, farWidth = 0;
  for (const [i, scale] of [1, 3].entries()) {
    const q = pose({ scale }), fit = s.update(q, absent, 1150 + i * 50).pose!;
    assert.equal(fit.calibrationRadius, first.calibrationRadius);
    for (let k = 0; k < 150; k++) applyCameraPose(model.group, fit, 1.5);
    assert.equal(model.group.scale.x, 1); assert.equal(model.wrist.scale.x, fit.radius); assert.equal(model.bracelet.scale.x, fit.radius * 1.5);
    const d = sizingDebug(fit, 1.5, 960, absent, 'calibrated', 'test');
    assert.equal(d.finalWorldScale, fit.radius * 1.5); if (i) nearWidth = d.projectedBraceletDiameterPx; else farWidth = d.projectedBraceletDiameterPx;
  }
  assert.ok(nearWidth / farWidth > 2.9 && nearWidth / farWidth < 3.1); disposeObjects(model.group);
});
test('Brief weak edges and ROI preserve calibration; prolonged actual Hand loss requires a fresh measurement', () => {
  const s = new LiveWristSizer(), p = pose(), first = acquire(s, p);
  s.missing(1200); assert.equal(s.update(p, absent, 1250).pose!.radius, first.radius);
  const roi = s.update(p, measured(p, p.radius * 4), 1300, { roi: true }); assert.equal(roi.method, 'predictive'); assert.equal(roi.pose!.radius, first.radius);
  s.missing(2800); assert.equal(s.update(p, absent, 2850).pose, null);
});
test('Low confidence / too few slices / axial inversion cannot update size', () => {
  const p = pose(), s = new LiveWristSizer(), first = acquire(s, p);
  for (let i = 1; i <= 20; i++) assert.equal(s.update(p, { ...measured(p, p.radius * 3), confidence: .7 }, 1100 + i * 33).pose!.radius, first.radius);
  const next = new LiveWristSizer(); for (let i = 0; i < 10; i++) assert.equal(next.update(p, { ...measured(p), sampleCount: 2 }, 1000 + i * 50).pose, null);
});
test('Live quaternion stays continuous through 180°, normalized and perpendicular to forearm, including q/-q input', () => {
  const filter = new LiveWristFilter(); let previous: WristPose | null = null;
  for (let i = 0; i <= 180; i++) {
    let p = pose({ twist: i * Math.PI / 180, roll: Math.sin(i / 180 * Math.PI) * .3, tilt: .2 });
    if (i % 2) p = { ...p, orientation: Object.fromEntries(Object.entries(p.orientation).map(([k, v]) => [k, -v])) as WristPose['orientation'] };
    const next = filter.update(p, 1000 + i * 33); assert.ok(next);
    const u = rotate(next.orientation, { x: 1, y: 0, z: 0 }), a = rotate(next.orientation, { x: 0, y: 0, z: 1 });
    assert.ok(Math.abs(u.x * a.x + u.y * a.y + u.z * a.z) < 1e-10); assert.ok(Math.abs(Math.hypot(...Object.values(next.orientation)) - 1) < 1e-10);
    if (previous) assert.ok(quaternionAngle(previous.orientation, next.orientation) < .07);
    previous = next;
  }
});
test('Lumière half-turn is actual geometry symmetry, including all 22 octahedron instances and elliptical section', () => {
  const model = createBraceletObjects(), half = new THREE.Matrix4().makeRotationZ(Math.PI), centers: THREE.Vector3[] = [];
  for (let i = 0; i < 22; i++) { const m = new THREE.Matrix4(); model.gems.getMatrixAt(i, m); centers.push(new THREE.Vector3().setFromMatrixPosition(m)); }
  for (const c of centers) assert.ok(centers.some(p => p.distanceTo(c.clone().applyMatrix4(half)) < 1e-6));
  const band = model.band.geometry.getAttribute('position'), positions = Array.from({ length: band.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(band, i));
  for (let i = 0; i < positions.length; i += 73) assert.ok(positions.some(v => v.distanceTo(positions[i].clone().applyMatrix4(half)) < 1e-6));
  assert.equal(BANGLE.oval, .84); assert.ok(BANGLE_INNER_RADIUS > WRIST_MODEL_RADIUS); disposeObjects(model.group);
});
test('Live jump candidates survive consecutive rejections; no reset-and-snap on second frame', () => {
  const f = new LiveWristFilter(), p = pose(), other = pose({ roll: 1.4 }); f.update(p, 1000);
  assert.equal(f.update(other, 1050), null); assert.equal(f.update(other, 1100), null); assert.ok(f.update(other, 1150));
});
test('Slow valid inference >250ms still enforces jump confirmation, and out-of-order frames are rejected', () => {
  const f = new LiveWristFilter(), p = pose(); f.update(p, 1000);
  assert.equal(f.update(pose({ roll: 1.4 }), 1650), null); assert.equal(f.update(p, 900), null);
});
test('One handedness misclassification does not cause a pose jump/reset', () => {
  const f = new LiveWristFilter(), p = pose(); f.update(p, 1000);
  const next = f.update({ ...p, handedness: 'Left' }, 1033); assert.ok(next); assert.equal(f.identityChanged, false);
});
test('Live state transitions acquire → track → degraded → lost, hiding on an unobserved frame and reacquiring a fresh size', () => {
  const s = new LiveWristSession(), p = pose(), options = { usable: true, auto: true, fixedSize: false };
  assert.equal(s.update(p, absent, null, 1000, options).status, 'ACQUIRING');
  for (const t of [1050, 1100, 1150]) s.update(p, measured(p), null, t, options);
  const tracked = s.update(p, measured(p), null, 1200, options); assert.equal(tracked.status, 'TRACKING'); assert.ok(tracked.fit?.pose);
  const weak = s.update(p, absent, null, 1250, options); assert.equal(weak.status, 'TRACKING', 'a valid calibration does not require fresh edges every frame'); assert.ok(weak.fit?.pose);
  const missing = s.update(null, absent, null, 1300, options); assert.equal(missing.status, 'DEGRADED'); assert.equal(missing.fit, null);
  assert.equal(s.update(null, absent, null, 3000, options).status, 'LOST');
  assert.equal(s.update(p, absent, null, 3050, options).fit?.pose, null);
});
test('Stale or mismatched worker frames never render, despite a fully valid landmark pose', () => {
  const s = new LiveWristSession(), p = pose(), options = { usable: true, auto: true, fixedSize: false };
  for (const t of [1000, 1050, 1100]) s.update(p, measured(p), null, t, options);
  assert.equal(s.update(p, measured(p), null, 1150, { ...options, usable: false }).fit, null);
});
test('Two different widths acquire independent radii without an enlargement constant', () => {
  const p = pose(), small = acquire(new LiveWristSizer(), p, measured(p, p.radius)), large = acquire(new LiveWristSizer(), p, measured(p, p.radius * 1.7));
  assert.ok(Math.abs(large.radius / small.radius - 1.7) < 1e-7);
});
test('Manual input is outside the live tracker/sizer, and fixed-size products do not opt into resizing', () => {
  const p = pose(); assert.equal(new LiveWristSizer().update(p, measured(p), 1000, { fixedSize: true }).pose, null);
  assert.ok(new LiveWristSizer().update(p, absent, 1000, { auto: false }).pose);
});
test('Live native-edge registration changes lateral placement only and remains continuous between sparse semantic frames', () => {
  const p = pose(), placement = new LiveWristPlacement(), center = project(p.center, p), m = measured(p);
  m.left = { x: center.x - .04, y: center.y }; m.right = { x: center.x + .06, y: center.y };
  const next = placement.update(p, m, 1000), hold = placement.update(p, absent, 1033);
  assert.deepEqual(next.orientation, p.orientation); assert.equal(next.radius, p.radius); assert.equal(next.center.z, p.center.z);
  assert.ok(Math.abs(project(next.center, next).x - project(hold.center, hold).x) < 1e-9);
  assert.ok(project(next.center, next).x > center.x);
});
function texture(dx = 0) {
  const width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = 100 + ((Math.imul(x - dx, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 60;
    data.set([v, v * .8, v * .65, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
test('Live ROI accepts a measured 320ms correspondence interval while old/default contract stays 250ms', () => {
  const p = pose(), live = new WristRoiTracker(500), original = new WristRoiTracker();
  assert.ok(live.seed(texture(), p, 1000)); assert.ok(original.seed(texture(), p, 1000));
  assert.equal(original.track(texture(2), 1320).pose, null);
  const result = live.track(texture(2), 1320); assert.ok(result.pose, result.reason); assert.ok(result.inliers >= 6);
  assert.equal(live.track(texture(4), 1900).pose, null, '500ms remains bounded');
});
test('Weak wrist measurement must not delete ROI evidence when a full Hand pose and calibrated size remain valid', () => {
  const s = new LiveWristSession(), p = pose(), options = { usable: true, auto: true, fixedSize: false };
  for (const t of [1000, 1050, 1100]) s.update(p, measured(p), texture(), t, options);
  const weak = s.update(p, absent, texture(), 1150, options); assert.ok(weak.fit?.pose); assert.ok(weak.seed.ready);
  const roi = s.update(null, absent, texture(2), 1470, options); assert.equal(roi.source, 'ROI'); assert.ok(roi.fit?.pose); assert.equal(roi.status, 'DEGRADED');
});
test('Live crease proposals do not bypass aperture/uniqueness rejection or invent tracking on featureless skin', () => {
  const p = pose(), width = 400, height = 300;
  const frame = (stripes: boolean) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const v = stripes ? 120 + Math.sin(x * .6) * 40 : 120; data.set([v, v, v, 255], (y * width + x) * 4);
    }
    return { width, height, data };
  };
  const roi = new WristRoiTracker(500, true); assert.equal(roi.seed(frame(false), p, 1000), false);
  if (roi.seed(frame(true), p, 1000)) assert.equal(roi.track(frame(true), 1100).pose, null, 'a straight edge alone has ambiguous motion along the edge');
});
