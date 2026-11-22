import { project, type WristPose } from './wristGeometry';
import type { WidthMeasurement } from './braceletSizing';

/** Explicit static-image registration, separate from measurement and sizing.
 * Only two native edges confirmed by semantic skin + multiple sections can
 * recenter the wear plane. Keep tracked quaternion and camera depth exactly. */
export function registerImageWrist(tracked: WristPose, observed: WidthMeasurement): WristPose {
  if (observed.image?.method !== 'semantic-body' || observed.width === null || observed.confidence < .8 || (observed.sampleCount ?? 0) < 5 || !observed.left || !observed.right) return tracked;
  const p = { x: (observed.left.x + observed.right.x) / 2, y: (observed.left.y + observed.right.y) / 2 }, original = project(tracked.center, tracked);
  const shift = Math.hypot(p.x - original.x, p.y - original.y);
  // Local correction only; unrelated skin components cannot relocate the hand.
  if (!Number.isFinite(shift) || shift > observed.width * .5 || p.x < .02 || p.x > .98 || p.y < .02 || p.y > tracked.aspect - .02) return tracked;
  return { ...tracked, center: { x: (p.x - .5) * tracked.center.z / tracked.focal, y: (p.y - tracked.aspect / 2) * tracked.center.z / tracked.focal, z: tracked.center.z } };
}
