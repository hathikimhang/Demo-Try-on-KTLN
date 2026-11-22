import { project } from '../geometry/wristGeometry';
import type { WristPose } from '../../models/wrist.types';
import type { WidthMeasurement } from '../../models/fitting.types';
/** Registration riêng cho ảnh, độc lập measurement và sizing. Chỉ cặp biên native được semantic skin và nhiều lát cắt xác nhận mới được chỉnh tâm; giữ nguyên quaternion và độ sâu camera. */
export function registerImageWrist(tracked: WristPose, observed: WidthMeasurement): WristPose {
  if (observed.image?.method !== 'semantic-body' || observed.width === null || observed.confidence < .8 || (observed.sampleCount ?? 0) < 5 || !observed.left || !observed.right) return tracked;
  const p = { x: (observed.left.x + observed.right.x) / 2, y: (observed.left.y + observed.right.y) / 2 }, original = project(tracked.center, tracked);
  const shift = Math.hypot(p.x - original.x, p.y - original.y);
  // Chỉ hiệu chỉnh cục bộ; vùng da không liên quan không được dời bàn tay.
  if (!Number.isFinite(shift) || shift > observed.width * .5 || p.x < .02 || p.x > .98 || p.y < .02 || p.y > tracked.aspect - .02) return tracked;
  return { ...tracked, center: { x: (p.x - .5) * tracked.center.z / tracked.focal, y: (p.y - tracked.aspect / 2) * tracked.center.z / tracked.focal, z: tracked.center.z } };
}
