import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { WidthMeasurement } from '../models/fitting.types';
import { handFixture } from './fixtures/wristFixtures';
import { estimateWrist, quaternionAngle, rotate } from '../services/geometry/wristGeometry';
import type { WristPose } from '../models/wrist.types';
import { projectedWidth } from '../services/fitting/braceletSizing';
import { FOREARM, WRIST_MODEL_RADIUS, BANGLE_INNER_RADIUS } from '../models/braceletDimensions';
import { test } from 'node:test';
import { LiveWristSizer } from '../services/live/liveWristSizing';
import { sizingDebug } from '../services/diagnostics/sizingDebug';
import { LiveContinuity, LIVE_GRACE_MS } from '../models/liveContinuity';
import { LiveWristSession } from '../services/live/liveWristTracking';
import { LiveForearmEstimator } from '../services/live/liveForearmPose';
import { applyCameraPose, createBraceletObjects, disposeObjects } from '../views/rendering/braceletModel';
const absent: WidthMeasurement = { width: null, confidence: 0, reason: 'edges unavailable, not a brightness diagnosis' };

const pose = (options: Parameters<typeof handFixture>[0] = {}) => { const f = handFixture(options), p = estimateWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }); assert.ok(p); return p; };

const known = (p: WristPose, radius = p.radius * 1.4): WidthMeasurement => ({ width: projectedWidth(p, radius, WRIST_MODEL_RADIUS, FOREARM.oval), confidence: .95, sampleCount: 9, reason: 'controlled observation' });

test('Wrist-first estimate may render before edge calibration, without claiming measured size', () => {
  const s = new LiveWristSizer(), p = pose(), first = s.update(p, absent, 1000, { allowEstimate: true });
  assert.ok(first.pose); assert.equal(first.method, 'provisional'); assert.equal(first.quality, 0); assert.equal(first.pose.calibrationRadius, undefined);
  const debug = sizingDebug(first.pose, 1, 640, absent, first.method, first.message); assert.equal(debug.status, 'provisional'); assert.equal(debug.fitRatio, null);
  assert.ok(!/ánh sáng/.test(first.message), 'no unsupported low-light diagnosis');
});

test('First trusted width supplies initial provisional sizing rather than an enlarged anatomical prior', () => {
  const p = pose(), radius = p.radius * 1.7, fit = new LiveWristSizer().update(p, known(p, radius), 1000, { allowEstimate: true });
  assert.ok(fit.pose); assert.equal(fit.method, 'provisional'); assert.ok(Math.abs(fit.pose.radius / radius - 1) < 1e-7);
});

test('Three consistent measurements confirm an estimate; initial estimated size never locks out Auto Fit', () => {
  const p = pose(), s = new LiveWristSizer(), radius = p.radius * 1.5; s.update(p, absent, 1000, { allowEstimate: true });
  let previous = p.radius, last;
  for (let i = 1; i <= 180; i++) {
    last = s.update(p, known(p, radius), 1000 + i * 50, { allowEstimate: true }); assert.ok(last.pose);
    assert.ok(Math.abs(Math.log(last.pose.radius / previous)) <= .18 * .05 + 1e-8, 'bounded transition without a one-frame size pop'); previous = last.pose.radius;
  }
  assert.equal(last!.method, 'image'); assert.ok(last!.pose!.calibrationRadius); assert.ok(Math.abs(last!.pose!.radius / radius - 1) < 1e-6);
});

test('An initial measured width survives a one-frame pose blink; acquisition does not restart at sample one', () => {
  const p = pose(), s = new LiveWristSizer();
  s.update(p, known(p), 1000); s.missing(1050); s.update(p, known(p), 1100);
  const third = s.update(p, known(p), 1150); assert.ok(third.pose); assert.equal(third.method, 'image');
});

test('A long true loss discards both estimated and measured session fit', () => {
  const p = pose(), s = new LiveWristSizer(), estimated = s.update(p, known(p, p.radius * 1.7), 1000, { allowEstimate: true }); assert.ok(estimated.pose);
  s.missing(2600); const next = s.update(p, absent, 2650, { allowEstimate: true }); assert.ok(next.pose); assert.equal(next.method, 'provisional'); assert.equal(next.pose.calibrationRadius, undefined); assert.ok(Math.abs(next.pose.radius / p.radius - 1) < 1e-7);
});

test('ROI cannot initialize fit on its own, and a fixed-size product never receives an estimated resize', () => {
  const p = pose(); assert.equal(new LiveWristSizer().update(p, absent, 1000, { allowEstimate: true, roi: true }).pose, null);
  assert.equal(new LiveWristSizer().update(p, known(p), 1000, { allowEstimate: true, fixedSize: true }).pose, null);
});

test('Grace preserves presentation for an isolated miss and cannot extend itself on repeated misses', () => {
  const c = new LiveContinuity(); c.update(1000, 1000, true, true, true); c.update(1033, 1033, true, true, true);
  const first = c.update(1066, 1066, false, false, true); assert.equal(first.status, 'DEGRADED'); assert.equal(first.presentation, 'hold'); assert.equal(first.holdUntil, 1033 + LIVE_GRACE_MS);
  const second = c.update(1200, 1200, false, false, true); assert.equal(second.holdUntil, first.holdUntil);
  const expired = c.update(1400, 1400, false, false, true); assert.equal(expired.presentation, 'hidden'); assert.equal(expired.status, 'LOST');
});

test('Recovery needs two good observations for TRACKING but displays the first good frame immediately', () => {
  const c = new LiveContinuity(); c.update(1000, 1000, true, true, true); c.update(1033, 1033, true, true, true); c.update(1066, 1066, false, false, true);
  const one = c.update(1100, 1100, true, true, true); assert.equal(one.status, 'DEGRADED'); assert.equal(one.presentation, 'current');
  const two = c.update(1133, 1133, true, true, true); assert.equal(two.status, 'TRACKING'); assert.equal(two.presentation, 'current');
});

test('Missing acquisition cannot hold a nonexistent good frame; stale/mismatched input cannot invoke grace', () => {
  const c = new LiveContinuity(); assert.equal(c.update(1000, 1000, false, false, true).presentation, 'hidden');
  c.update(1033, 1033, true, true, true); assert.equal(c.update(1066, 1066, false, false, false).presentation, 'hidden');
});

test('Duplicate and old messages do not poison hysteresis or move the grace deadline forward', () => {
  const c = new LiveContinuity(); c.update(1000, 1000, true, true, true); const miss = c.update(1033, 1033, false, false, true);
  assert.equal(c.update(900, 1100, true, true, true).ignored, true); assert.equal(c.update(1000, 1200, true, true, true).ignored, true);
  assert.equal(c.update(1350, 1350, false, false, true).status, 'LOST'); assert.equal(miss.holdUntil, 1300);
});

test('Ten seconds stationary and twenty seconds controlled rotation retain a visible presentation through isolated bad frames', () => {
  const session = new LiveWristSession(), options = { usable: true, auto: true, fixedSize: false, allowEstimate: true };
  let held = 0;
  for (let i = 0; i <= 900; i++) {
    const t = 1000 + i * 33, p = pose({ twist: i < 300 ? 0 : (i - 300) / 600 * Math.PI });
    const miss = i > 5 && i % 37 === 0;
    const r = session.update(miss ? null : p, i < 30 ? known(p) : absent, null, t, options);
    assert.notEqual(r.presentation, 'hidden', `frame ${i} must not blink`);
    if (miss) { assert.equal(r.presentation, 'hold'); assert.equal(r.fit, null, 'presentation retains an image, not an old pose as current data'); held++; }
  }
  assert.ok(held >= 20);
});

test('A rejected orientation candidate can use actual ROI correspondences rather than blinking', () => {
  const f = handFixture(), p = pose(), width = 400, height = 300, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = 100 + ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 60; data.set([v, v * .8, v * .65, 255], (y * width + x) * 4); }
  const pixels = { width, height, data }, s = new LiveWristSession(), opts = { usable: true, auto: true, fixedSize: false };
  for (const t of [1000, 1033, 1066]) s.update(p, known(p), pixels, t, opts);
  const tilted = pose({ roll: 1.4 }), held = s.update(tilted, absent, pixels, 1100, opts);
  assert.equal(held.source, 'ROI'); assert.equal(held.presentation, 'current'); assert.ok(held.fit?.pose); assert.ok(held.roi!.inliers >= 6);
  assert.ok(quaternionAngle(held.fit.pose.orientation, p.orientation) < 1e-6); assert.equal(f.points.length, 21);
});

test('Learned Hand-to-forearm relation preserves the independently observed plane through rigid Hand rotation', () => {
  const first = pose(), e = new LiveForearmEstimator(), axis = rotate(first.orientation, { x: 0, y: 0, z: 1 });
  const initial = e.update(first, { direction: { x: axis.x, y: axis.y }, confidence: .95, source: 'contour-rgb', reason: 'controlled contour', sections: [] }, 1000); assert.ok(initial.pose);
  const input = pose({ roll: .35 }), next = e.update(input, null, 1450); assert.ok(next.pose); assert.equal(next.source, 'hand-calibrated'); assert.ok(next.confidence < .75);
  assert.ok(Math.abs(Math.hypot(...Object.values(next.pose.orientation)) - 1) < 1e-10);
});

test('Estimated and measured fit keep Manual Fit outside the tracker and preserve the wrist/model coordinate contract', () => {
  const p = pose(), s = new LiveWristSizer(), fit = s.update(p, absent, 1000, { allowEstimate: true }); assert.ok(fit.pose);
  const model = createBraceletObjects();
  for (const manual of [1, 1.5]) {
    for (let i = 0; i < 100; i++) applyCameraPose(model.group, fit.pose, manual);
    assert.equal(model.group.scale.x, 1); assert.equal(model.wrist.scale.x, fit.pose.radius); assert.equal(model.bracelet.scale.x, fit.pose.radius * manual);
    assert.ok(model.group.position.equals(new THREE.Vector3(fit.pose.center.x, -fit.pose.center.y, -fit.pose.center.z)));
    assert.ok(BANGLE_INNER_RADIUS > WRIST_MODEL_RADIUS);
  }
  disposeObjects(model.group);
});

test('Estimated acquisition stores a real reference view when confirmed; rotating later cannot enable per-angle radius inflation', () => {
  const p = pose(), s = new LiveWristSizer(), width = known(p);
  for (const t of [1000, 1050, 1100]) s.update(p, width, t, { allowEstimate: true });
  const k = s.update(p, width, 1150, { allowEstimate: true }).pose!.calibrationRadius!;
  for (let i = 1; i <= 90; i++) {
    const rotated = pose({ twist: Math.PI / 4 });
    const next = s.update(rotated, width, 1150 + i * 33, { allowEstimate: true }); assert.ok(next.pose);
    assert.ok(Math.abs(next.pose.calibrationRadius! / k - 1) < 1e-8, 'constant width at a different view is not a new physical size');
  }
});

test('A confirmed fit finishes its bounded transition after boundaries disappear, instead of remaining undersized indefinitely', () => {
  const p = pose(), s = new LiveWristSizer(), radius = p.radius * 1.5; s.update(p, absent, 1000, { allowEstimate: true });
  for (const t of [1050, 1100, 1150]) s.update(p, known(p, radius), t, { allowEstimate: true });
  let next;
  for (let i = 1; i <= 150; i++) next = s.update(p, absent, 1150 + i * 33, { allowEstimate: true });
  assert.ok(next!.pose); assert.equal(next!.method, 'calibrated'); assert.ok(Math.abs(next!.pose!.radius / radius - 1) < 1e-7);
});

test('An edge-on start may use observed pixel width as an estimate without claiming confirmed physical size', () => {
  const p = pose({ twist: Math.PI / 2 }), radius = p.radius * 1.6;
  const next = new LiveWristSizer().update(p, known(p, radius), 1000, { allowEstimate: true }); assert.ok(next.pose); assert.equal(next.method, 'provisional');
  assert.equal(next.pose.calibrationRadius, undefined); assert.ok(Math.abs(next.pose.radius / radius - 1) < 1e-7);
});
