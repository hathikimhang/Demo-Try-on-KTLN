import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveStabilityDiagnostics } from '../services/diagnostics/liveStabilityDiagnostics';
import { LiveContinuity } from '../models/liveContinuity';
import { analyzeWrist } from '../services/geometry/wristGeometry';
import { handFixture } from './fixtures/wristFixtures';

const f = handFixture(), pose = analyzeWrist(f.points, f.world, f.aspect, 'Right', { mode: 'straight-wrist' }).pose!;
const input = { frameId: 1, capturedAt: 1000, receivedAt: 1050, raw: pose, filtered: pose, source: 'Hand', trackingState: 'TRACKING', confidence: .4, rejectReason: 'ok', inferenceLatencyMs: 50, mask: null };
test('stability trace counts actual visibility transitions, not repeated hidden frames', () => {
  const d = new LiveStabilityDiagnostics(); d.observe(input);
  assert.equal(d.snapshot(1060, true, 'current-frame-pose', {}, 1000).visibilityChangeCount, 1);
  assert.equal(d.snapshot(1070, true, 'current-frame-pose', {}, 1000).visibilityChangeCount, 1);
  assert.equal(d.snapshot(1080, false, 'stale-frame', {}, null).visibilityChangeCount, 2);
  assert.equal(d.snapshot(1090, false, 'stale-frame', {}, null).visibilityChangeCount, 2);
});
test('stability trace distinguishes quaternion sign from physical rotation and preserves confidence', () => {
  const d = new LiveStabilityDiagnostics(); d.observe(input);
  const q = pose.orientation;
  d.observe({ ...input, frameId: 2, capturedAt: 1100, raw: { ...pose, orientation: { x: -q.x, y: -q.y, z: -q.z, w: -q.w } } });
  const s = d.snapshot(1150, true, 'current-frame-pose', {}, 1100);
  assert.equal(s.rawQuaternionSignChangeCount, 1); assert.ok(s.rawAngularDeltaRadians! < 1e-7);
  assert.equal(s.confidence, .4);
});
test('stability trace separates drop/backlog telemetry from tracking loss', () => {
  const d = new LiveStabilityDiagnostics(); d.observe(input);
  const s = d.snapshot(1060, true, 'current-frame-pose', { cameraFPS: 30, inferenceFPS: 10, webglFPS: 10, droppedCameraFrames: 20, maxPendingRequests: 1 }, 1000);
  assert.equal(s.frameDropCount, 20); assert.equal(s.braceletVisible, true);
  assert.equal(s.cameraFPS, 30); assert.equal(s.renderFPS, 10); assert.equal(s.poseAgeMs, 60);
});
test('mask coverage does not assert that pixels are visible or change tracking decisions', () => {
  const d = new LiveStabilityDiagnostics(); d.observe({ ...input, mask: { width: 2, height: 1, data: new Uint8Array([0, 255]), roi: { x: 0, y: 0, width: 1, height: 1 } } });
  const s = d.snapshot(1060, true, 'current-frame-pose', {}, 1000);
  assert.equal(s.maskCoverageSampled, .5); assert.equal(s.braceletVisible, true);
  assert.match(s.visibilityDefinition, /pixel occlusion not measured/);
});
test('reproduction: one missing result after a >300ms inference interval expires V1 grace', () => {
  const c = new LiveContinuity();
  c.update(1000, 1000, true, true, true);
  assert.equal(c.update(1400, 1400, false, false, true).presentation, 'hidden');
  assert.equal(c.update(1800, 1800, true, true, true).presentation, 'current');
  // Identifies a possible flicker mechanism, not proof it occurred on user webcam.
});
