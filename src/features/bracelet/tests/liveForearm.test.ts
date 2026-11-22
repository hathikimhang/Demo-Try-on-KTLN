import * as THREE from 'three';
import assert from 'node:assert/strict';
import type { V3, WristPose, ForearmContour } from '../models/wrist.types';
import { add, mul, project, length, cross, dot, rotate, sub, quaternionAngle, estimateWrist, analyzeWrist } from '../services/geometry/wristGeometry';
import { test } from 'node:test';
import { normalized, axisAngle, wristFrame, axisFromScreen, filterWristOrientation } from '../services/live/liveWristFrame';
import { measureForearmContour } from '../services/live/liveForearmContour';
import { LiveForearmEstimator } from '../services/live/liveForearmPose';
import { configureCamera, applyCameraPose, createBraceletObjects, disposeObjects } from '../views/rendering/braceletModel';
import { LiveWristSizer } from '../services/live/liveWristSizing';
import { projectedWidth } from '../services/fitting/braceletSizing';
import { FOREARM, WRIST_MODEL_RADIUS } from '../models/braceletDimensions';
import { WristRoiTracker } from '../services/tracking/wristRoiTracking';
import { handFixture } from './fixtures/wristFixtures';
const radians = (n: number) => n * Math.PI / 180;

const anchor: V3 = { x: 0, y: -.045, z: 1.35 };

function hand(angle = 0, twist = 0, pitch = 0, scale = 1): WristPose {
  // Đối chứng Three.js độc lập: Z local ban đầu trùng hướng +Y của CV.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians(angle))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), radians(pitch - 90)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians(twist)));
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return { center: add(anchor, mul(axis, .04 * scale)), orientation: { x: q.x, y: q.y, z: q.z, w: q.w }, palmLength: .16 * scale, radius: .055 * scale, distanceScale: .16 * scale, focal: 1.35, aspect: .75, handedness: 'Right', source: 'straight-wrist' };
}

function image(angle = 0, options: { shadow?: boolean; ambiguous?: boolean; curved?: boolean } = {}) {
  const width = 640, height = 480, data = new Uint8ClampedArray(width * height * 4), confidence = new Float32Array(width * height);
  const a = { x: -Math.sin(radians(angle)), y: Math.cos(radians(angle)) }, c = project(anchor, hand());
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = (x + .5) / width - c.x, dy = (y + .5) / width - c.y, along = dx * a.x + dy * a.y;
    const across = dx * a.y - dy * a.x - (options.curved ? Math.sin(along * 120) * .045 : 0);
    const inside = Math.abs(across) < .06 && along > -.025 && along < .29;
    const dark = options.shadow && Math.abs(across) > .012 && Math.abs(across) < .03 ? 35 : 0;
    const color = inside && !options.ambiguous ? [185 - dark, 126 - dark, 99 - dark] : [234, 235, 237];
    data.set([...color, 255], (y * width + x) * 4); confidence[y * width + x] = inside ? 1 : 0;
  }
  return { roi: { x: 0, y: 0, width, height, imageWidth: width, imageHeight: height, data }, skin: { width, height, confidence } };
}

function known(direction: { x: number; y: number } = { x: 0, y: 1 }): ForearmContour {
  return { direction, confidence: .95, reason: 'known independent foreground', source: 'contour-rgb', sections: [] };
}

test('Normalization rejects zero/nonfinite vectors instead of supplying a fictional axis', () => {
  for (const v of [{ x: 0, y: 0, z: 0 }, { x: NaN, y: 1, z: 0 }, { x: 1, y: Infinity, z: 0 }]) assert.equal(normalized(v), null);
  assert.ok(Math.abs(length(normalized({ x: 2, y: 3, z: 4 })!) - 1) < 1e-12);
});

for (const angle of [0, 20, 45, 90, 180]) test(`Orthonormal wrist frame ${angle}° has determinant +1, correct model normal and normalized quaternion`, () => {
  const p = hand(angle), axis = rotate(p.orientation, { x: 0, y: 0, z: 1 }), across = rotate(p.orientation, { x: 1, y: 0, z: 0 }), basis = wristFrame(axis, across); assert.ok(basis);
  assert.ok(Math.abs(dot(cross(basis.x, basis.y), basis.z) - 1) < 1e-12);
  assert.ok(Math.abs(dot(basis.x, basis.y)) + Math.abs(dot(basis.x, basis.z)) + Math.abs(dot(basis.y, basis.z)) < 1e-12);
  assert.ok(axisAngle(rotate(basis.orientation, { x: 0, y: 0, z: 1 }), axis) < 1e-7);
  assert.ok(Math.abs(Math.hypot(...Object.values(basis.orientation)) - 1) < 1e-12);
});

for (const bend of [0, 20, 45]) test(`Native forearm contour is independent of a hand bent ${bend}° from the actual arm`, () => {
  const { roi, skin } = image(), p = hand(bend), wrist = project(anchor, p);
  for (const mask of [undefined, skin]) {
    const result = measureForearmContour(roi, p, { x: wrist.x, y: wrist.y / p.aspect }, mask);
    assert.ok(result.direction, result.reason); assert.ok(result.confidence >= .75); assert.ok(result.sections.length >= 6);
    assert.ok(Math.acos(result.direction.y) < radians(1.5), 'direction must follow image forearm, not the bent hand');
  }
});

for (const angle of [0, 20, 45, 90, 180]) test(`Visible forearm angle ${angle}° follows actual arm motion in image space`, () => {
  const p = hand(angle), { roi } = image(angle), c = project(anchor, p), result = measureForearmContour(roi, p, { x: c.x, y: c.y / p.aspect });
  // Ở 180°, cẳng tay tổng hợp vẫn nhìn thấy về phía trên khung.
  assert.ok(result.direction, result.reason);
  assert.ok(Math.acos(Math.max(-1, Math.min(1, result.direction.x * -Math.sin(radians(angle)) + result.direction.y * Math.cos(radians(angle))))) < radians(1.5));
});

test('Shadow stripes inside skin cannot replace exterior forearm boundaries', () => {
  const p = hand(20), a = image(0, { shadow: true }), c = project(anchor, p);
  for (const mask of [undefined, a.skin]) {
    const result = measureForearmContour(a.roi, p, { x: c.x, y: c.y / p.aspect }, mask); assert.ok(result.direction, result.reason);
    assert.ok(result.sections.every(s => s.width > 70), 'reject the narrow dark stripe as a complete wrist silhouette');
  }
});

test('Ambiguous foreground and curved clutter reject an independent arm axis', () => {
  const p = hand(), c = project(anchor, p);
  assert.equal(measureForearmContour(image(0, { ambiguous: true }).roi, p, { x: c.x, y: c.y / p.aspect }).direction, null);
  assert.equal(measureForearmContour(image(0, { curved: true }).roi, p, { x: c.x, y: c.y / p.aspect }).direction, null);
});

test('Priority 20°: corrected normal and proximal centre follow forearm, while raw hand-axis placement reproduces drift', () => {
  const e = new LiveForearmEstimator(); e.update(hand(), known(), 1000);
  const raw = hand(20), result = e.update(raw, known(), 1033); assert.ok(result.pose);
  assert.ok(axisAngle(result.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
  const expected = add(anchor, { x: 0, y: .04, z: 0 });
  assert.ok(length(sub(result.pose.center, expected)) < 1e-12);
  assert.ok(length(sub(raw.center, expected)) > .013, 'old axis causes a verifiable offset error at 20 degrees');
  assert.ok(axisAngle(rotate(raw.orientation, { x: 0, y: 0, z: 1 }), result.forearmAxis!) > radians(19));
});

test('Straight 0° baseline keeps the same rigid centre, orientation and size', () => {
  const p = hand(), result = new LiveForearmEstimator().update(p, known(), 1000); assert.ok(result.pose);
  assert.ok(length(sub(result.pose.center, p.center)) < 1e-12); assert.ok(quaternionAngle(result.pose.orientation, p.orientation) < 1e-7);
  assert.equal(result.pose.radius, p.radius); assert.equal(result.pose.distanceScale, p.distanceScale);
});

test('0→180 forearm roll changes twist continuously without moving the normal or wrist centre', () => {
  const e = new LiveForearmEstimator(); let previous: WristPose | null = null;
  for (let angle = 0; angle <= 180; angle += 2) {
    const result = e.update(hand(0, angle), known(), 1000 + angle * 16); assert.ok(result.pose);
    assert.ok(axisAngle(result.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
    assert.ok(length(sub(result.pose.center, hand().center)) < 1e-12);
    if (previous) assert.ok(quaternionAngle(result.pose.orientation, previous.orientation) < radians(2.01)); previous = result.pose;
  }
});

test('Matched Pose supplies true observed forearm depth; hand flexion does not change the selected plane', () => {
  const arm = hand(20, 0, 30), result = new LiveForearmEstimator().update(hand(0, 0, -10), known(), 1000, arm);
  assert.ok(result.pose); assert.equal(result.source, 'Pose'); assert.equal(result.depth, 'Pose');
  assert.ok(axisAngle(result.forearmAxis!, rotate(arm.orientation, { x: 0, y: 0, z: 1 })) < 1e-7);
  assert.equal(result.pose.source, 'straight-wrist', 'Pose observation cannot trigger a requested-mode change');
});

test('Unobserved out-of-plane wrist flexion cannot silently become forearm yaw; bounded degradation then rejection', () => {
  const e = new LiveForearmEstimator(); e.update(hand(), known(), 1000);
  const uncertain = e.update(hand(0, 0, 20), known(), 1050); assert.ok(uncertain.pose); assert.ok(uncertain.confidence < .75);
  assert.ok(axisAngle(uncertain.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
  const rejected = e.update(hand(0, 0, 20), known(), 1600); assert.equal(rejected.pose, null); assert.equal(rejected.reason, 'unobserved-forearm-depth');
});

test('Wrist-first fallback follows supported Hand motion without elbow, labelled as an assumption; observed-axis grace is bounded', () => {
  const e = new LiveForearmEstimator(); const initial = e.update(hand(), null, 1000); assert.equal(initial.source, 'hand-assumption');
  const tilt = e.update(hand(20), null, 1033); assert.ok(tilt.pose); assert.equal(tilt.source, 'hand-assumption'); assert.ok(tilt.confidence < .75);
  assert.ok(axisAngle(tilt.forearmAxis!, rotate(hand(20).orientation, { x: 0, y: 0, z: 1 })) < 1e-7);
  const observed = new LiveForearmEstimator(); observed.update(hand(), known(), 1000);
  assert.equal(observed.update(hand(), null, 1100).source, 'temporal-axis');
  const calibrated = observed.update(hand(), null, 1600); assert.ok(calibrated.pose); assert.equal(calibrated.source, 'hand-calibrated');
  observed.missing(3200); assert.equal(observed.update(hand(), null, 3250).source, 'hand-assumption', 'long real loss clears the learned arm relation');
});

test('Degenerate basis needs a previously observed transverse direction; transport is explicit and bounded', () => {
  assert.equal(wristFrame({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }), null);
  assert.ok(wristFrame({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, hand().orientation)?.transported);
});

test('Quaternion signs remain continuous across matrix branches and negative input signs', () => {
  let previous = hand().orientation;
  for (let i = 0; i <= 180; i++) {
    const q = hand(i, i).orientation, basis = wristFrame(rotate(q, { x: 0, y: 0, z: 1 }), rotate(q, { x: 1, y: 0, z: 0 }), previous); assert.ok(basis);
    assert.ok(dot(previous, basis.orientation) + previous.w * basis.orientation.w >= 0); previous = basis.orientation;
  }
});

test('Screen-direction lift uses exact perspective derivative off-centre without dividing by cos(view)', () => {
  const p = hand(), c = { x: .3, y: -.2, z: 1.4 }, d = { x: .8, y: .6 }, a = axisFromScreen(d, .35, c); assert.ok(a);
  const x = project(c, p), y = project(add(c, mul(a, .001)), p), dx = y.x - x.x, dy = y.y - x.y;
  assert.ok((dx * d.x + dy * d.y) / Math.hypot(dx, dy) > .99999999); assert.ok(Math.abs(length(a) - 1) < 1e-12);
  assert.equal(axisFromScreen({ x: 0, y: 0 }, 0, c), null);
});

test('Swing filtering is independent of roll and keeps the model normal on the filtered forearm axis', () => {
  for (const roll of [0, 45, 90, 180]) {
    const q = filterWristOrientation(hand().orientation, hand(20, roll).orientation, .5, .2); assert.ok(q);
    const target = rotate(hand(20).orientation, { x: 0, y: 0, z: 1 });
    assert.ok(axisAngle(rotate(q, { x: 0, y: 0, z: 1 }), target) <= .0800001);
  }
});

test('World→Three camera→image transform matches CV projection, including wrist offset and independent manual scale', () => {
  const p = hand(20), objects = createBraceletObjects(), camera = new THREE.PerspectiveCamera(); configureCamera(camera, p.focal, p.aspect);
  for (const fit of [1, 1.5]) {
    applyCameraPose(objects.group, p, fit); objects.group.updateMatrixWorld(true); const center = new THREE.Vector3().setFromMatrixPosition(objects.band.matrixWorld).project(camera), cv = project(p.center, p);
    assert.ok(Math.abs((center.x + 1) / 2 - cv.x) < 1e-12); assert.ok(Math.abs((1 - center.y) * p.aspect / 2 - cv.y) < 1e-12);
    assert.equal(objects.group.scale.x, 1); assert.equal(objects.wrist.scale.x, p.radius);
  }
  disposeObjects(objects.group);
});

test('Corrected axis 0/20/45/90/180 preserves intrinsic wrist size; distance multiplies once', () => {
  const sizer = new LiveWristSizer(), p = hand(), measurement = { width: projectedWidth(p, p.radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .95, sampleCount: 9, reason: 'known native width' };
  for (const t of [1000, 1050, 1100]) sizer.update(p, measurement, t);
  const k = sizer.update(p, measurement, 1150).pose!.calibrationRadius;
  const e = new LiveForearmEstimator(); e.update(p, known(), 1000);
  for (const angle of [0, 20, 45, 90, 180]) {
    const h = hand(angle), corrected = e.update(h, known({ x: -Math.sin(radians(angle)), y: Math.cos(radians(angle)) }), 1200 + angle); assert.ok(corrected.pose);
    const result = sizer.update(corrected.pose, { width: null, confidence: 0, reason: 'temporarily unavailable' }, 1200 + angle); assert.ok(result.pose); assert.equal(result.pose.calibrationRadius, k);
  }
  const near = hand(0, 0, 0, 1.4), fit = sizer.update(near, { width: null, confidence: 0, reason: 'none' }, 1450).pose!;
  assert.ok(Math.abs(fit.radius / p.radius - 1.4) < 1e-7);
});

test('Out-of-order orientation observations cannot reset and replace a valid forearm calibration', () => {
  const e = new LiveForearmEstimator(); const first = e.update(hand(), known(), 1000); assert.ok(first.pose);
  assert.equal(e.update(hand(45), known({ x: -Math.SQRT1_2, y: Math.SQRT1_2 }), 900).reason, 'orientation-out-of-order');
  const next = e.update(hand(), known(), 1033); assert.ok(next.pose); assert.ok(axisAngle(next.forearmAxis!, first.forearmAxis!) < 1e-7);
});

test('One Pose depth spike cannot poison following contour frames or force a plane flip', () => {
  const e = new LiveForearmEstimator(); e.update(hand(), known(), 1000);
  const spike = e.update(hand(), known(), 1033, hand(0, 0, 45)); assert.ok(spike.pose); assert.equal(spike.reason, 'pose-depth-pending'); assert.ok(e.needsArmConfirmation);
  assert.ok(axisAngle(spike.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
  const next = e.update(hand(), known(), 1066, hand()); assert.ok(next.pose); assert.equal(e.needsArmConfirmation, false);
  assert.ok(axisAngle(next.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
});

test('Three coherent fresh Pose observations can establish genuine forearm pitch', () => {
  const e = new LiveForearmEstimator(); e.update(hand(), known(), 1000);
  let result;
  for (const t of [1033, 1066, 1099]) result = e.update(hand(0, 0, 30), known(), t, hand(0, 0, 30));
  assert.ok(result!.pose); assert.equal(result!.source, 'Pose'); assert.equal(e.needsArmConfirmation, false);
  assert.ok(axisAngle(result!.forearmAxis!, rotate(hand(0, 0, 30).orientation, { x: 0, y: 0, z: 1 })) < 1e-7);
});

function patchTexture(cut = 0) {
  const width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = y < cut ? 220 : 100 + ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 60;
    data.set([v, v * .8, v * .65, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('Partial ROI uses surviving correspondence consensus, not the number of features now occluded', () => {
  const f = handFixture(), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }); assert.ok(p);
  const original = new WristRoiTracker(500, true), partial = new WristRoiTracker(500, true, true);
  assert.ok(original.seed(patchTexture(), p, 1000)); assert.ok(partial.seed(patchTexture(), p, 1000));
  assert.equal(original.track(patchTexture(175), 1050).pose, null);
  const retained = partial.track(patchTexture(175), 1050); assert.ok(retained.pose, retained.reason); assert.ok(retained.inliers >= 6); assert.equal(retained.inliers, retained.matches);
  assert.ok(length(sub(retained.pose.center, p.center)) < 1e-8);
});

test('An observed empty foreground mask prevents background texture from seeding wrist tracking', () => {
  const f = handFixture(), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }); assert.ok(p);
  const roi = new WristRoiTracker(500, true, true);
  assert.ok(roi.seed(patchTexture(), p, 1000));
  assert.equal(roi.seed(patchTexture(), p, 1000, { width: 1, height: 1, data: new Uint8Array([0]), roi: { x: 0, y: 0, width: 1, height: 1 } }), false);
  assert.equal(roi.track(patchTexture(), 1050).pose, null);
});

test('Live may defer the Hand-axis axial gate to a validated forearm; Upload retains its original gate', () => {
  const f = handFixture({ tilt: .95 }), old = analyzeWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' });
  assert.equal(old.reason, 'axial-view'); assert.equal(old.pose, null);
  const live = analyzeWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist', deferAxialCheck: true }); assert.ok(live.pose);
  const result = new LiveForearmEstimator().update(live.pose, known(), 1000, hand()); assert.ok(result.pose); assert.equal(result.source, 'Pose');
  assert.ok(axisAngle(result.forearmAxis!, { x: 0, y: 1, z: 0 }) < 1e-7);
});

test('Deferred Hand check cannot invent initial forearm depth or skip invalid-data validation', () => {
  const f = handFixture({ tilt: .95 }), live = analyzeWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist', deferAxialCheck: true }); assert.ok(live.pose);
  assert.equal(new LiveForearmEstimator().update(live.pose, known(), 1000).reason, 'initial-forearm-depth-unobserved');
  const points = f.points.map(p => ({ ...p })); points[5].x = NaN;
  assert.equal(analyzeWrist(points, f.world, f.aspect, 'Right', { mode: 'straight-wrist', deferAxialCheck: true }).reason, 'invalid-data');
});

test('Live seed must reject locally ambiguous NCC patches before they consume the feature budget', () => {
  const f = handFixture(), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }); assert.ok(p);
  const frame = patchTexture();
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) { const v = 120 + Math.sin(x * .6) * 40; frame.data.set([v, v, v, 255], (y * frame.width + x) * 4); }
  const tracker = new WristRoiTracker(500, true, true);
  assert.equal(tracker.seed(frame, p, 1000), false); assert.ok(tracker.seedEvidence.rejectedAmbiguous > 0);
});
