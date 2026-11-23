import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LiveV2Continuity } from '../services/engine/liveV2Continuity';
import { LiveContinuity } from '../models/liveContinuity';
import { analyzeWrist, length, sub, quaternionAngle } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';
import * as THREE from 'three';
const h = handFixture(), pose = analyzeWrist(h.points, h.world, h.aspect, 'Right', { mode: 'straight-wrist' }).pose!;
const seed = () => { const c = new LiveV2Continuity(); c.update(pose, 1000, 1000, true, .4, 'ok'); c.update(pose, 1033, 1033, true, .4, 'ok'); return c; };
test('V2 waits for two observations without increasing estimated orientation confidence', () => {
  const c = new LiveV2Continuity(); assert.equal(c.read(1000).state, 'ACQUIRING');
  assert.equal(c.update(pose, 1000, 1000, true, .4, 'ok').accepted, false);
  assert.equal(c.update(pose, 1033, 1033, true, .4, 'ok').accepted, true);
  assert.equal(c.read(1033).confidence, .4); assert.equal(c.read(1033).state, 'DEGRADED');
});
test('V2 holds one missing observation, fades and expires without extending its last good time', () => {
  const c = seed(); c.update(null, 1066, 1066, true, 0, 'orientation-rejected');
  assert.equal(c.read(1070).visible, true); assert.equal(c.read(1070).confidence, 0);
  assert.equal(c.read(1070).capturedAt, 1033); assert.equal(c.read(1070).reason, 'matched-frame-grace');
  c.update(null, 1166, 1166, true, 0, 'no-hand');
  assert.ok(c.read(1253).opacity > 0 && c.read(1253).opacity < 1);
  assert.equal(c.read(1273).visible, false); assert.equal(c.read(1273).filterResetCount, 1);
  assert.equal(c.read(3000).filterResetCount, 1, 'loss must reset once, not each RAF');
});
test('V2 suppresses isolated valid pulses after loss rather than flashing on each pulse', () => {
  const c = seed(), v1 = new LiveContinuity(); v1.update(1000, 1000, true, true, true);
  c.read(1400); let v1Toggles = 0, previous = false;
  for (let i = 0; i < 8; i++) {
    const t = 1500 + i * 400, good = i % 2 === 0;
    c.update(good ? pose : null, t, t, true, .4, good ? 'ok' : 'no-hand');
    assert.equal(c.read(t).visible, false);
    const visible = v1.update(t, t, good, good, true).presentation !== 'hidden';
    if (visible !== previous) v1Toggles++; previous = visible;
  }
  assert.ok(v1Toggles >= 6, 'reproduces V1 pulse visibility without changing V1');
});
test('V2 bounded filter reduces controlled stationary noise without altering sizing', () => {
  const c = seed(); let rawEnergy = 0, filteredEnergy = 0;
  for (let i = 1; i <= 200; i++) {
    const noise = i % 2 ? .002 : -.002, raw = { ...pose, center: { ...pose.center, x: pose.center.x + noise }, calibrationRadius: .33 };
    const r = c.update(raw, 1033 + i * 16, 1033 + i * 16, true, .4, 'ok'); assert.ok(r.pose);
    assert.equal(r.pose.radius, raw.radius); assert.equal(r.pose.calibrationRadius, .33);
    assert.ok(length(sub(r.pose.center, raw.center)) <= raw.radius * .1 + 1e-10);
    if (i > 10) { rawEnergy += noise ** 2; filteredEnergy += (r.pose.center.x - pose.center.x) ** 2; }
  }
  assert.ok(Math.sqrt(filteredEnergy / rawEnergy) < .8);
});
test('V2 follows fast translation with bounded instantaneous error instead of hiding it with lag', () => {
  const c = seed();
  for (let i = 1; i < 100; i++) {
    const p = { ...pose, center: { ...pose.center, x: pose.center.x + i * .02 } };
    const r = c.update(p, 1033 + i * 33, 1033 + i * 33, true, .9, 'ok'); assert.ok(r.pose);
    assert.ok(length(sub(r.pose.center, p.center)) <= p.radius * .1 + 1e-10);
  }
});
test('V2 q/-q changes preserve physical continuity without a reset', () => {
  const c = seed(), q = pose.orientation;
  const r = c.update({ ...pose, orientation: { x: -q.x, y: -q.y, z: -q.z, w: -q.w } }, 1066, 1066, true, .9, 'ok'); assert.ok(r.pose);
  assert.ok(quaternionAngle(r.pose.orientation, q) < 1e-7); assert.equal(c.filterResetCount, 0);
});
test('V2 short confidence dips and duplicate packets do not reset the filter or extend grace', () => {
  const c = seed(); c.update(pose, 1066, 1066, true, .1, 'low-confidence');
  assert.equal(c.filterResetCount, 0);
  assert.equal(c.update(pose, 1000, 1100, true, .9, 'ok').ignored, true);
  assert.equal(c.read(1100).capturedAt, 1066);
});
test('V2 slow 90 degree rotation and return keep angular lag bounded to 0.035 radians', () => {
  const c = seed();
  for (let i = 1; i <= 240; i++) {
    const t = i <= 120 ? i / 120 : (240 - i) / 120;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), t * Math.PI / 2).multiply(new THREE.Quaternion(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w));
    const raw = { ...pose, orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
    const r = c.update(raw, 1033 + i * 16, 1033 + i * 16, true, .9, 'ok'); assert.ok(r.pose);
    assert.ok(quaternionAngle(raw.orientation, r.pose.orientation) <= .035 + 1e-7);
    assert.equal(r.pose.radius, raw.radius); assert.equal(c.filterResetCount, 0);
  }
});
