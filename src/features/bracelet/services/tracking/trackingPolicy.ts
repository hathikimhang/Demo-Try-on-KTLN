import { dot, rotate } from '../geometry/wristGeometry';
import type { WristPose } from '../../models/wrist.types';
export function wristViewAngle(pose: WristPose) {
  const normal = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
  // Basis bangle có đối xứng nửa vòng; incidence tuyệt đối tránh
  // báo nhảy 180° giả khi chọn basis tương đương.
  return Math.acos(Math.max(0, Math.min(1, Math.abs(dot(normal, pose.center)) / Math.hypot(pose.center.x, pose.center.y, pose.center.z)))) * 180 / Math.PI;
}


// Kết quả đi cùng ảnh suy luận có thể cũ hơn một frame khi CPU chậm.
// Phân biệt suy luận chậm với Worker bị treo và giới hạn cả hai loại độ cũ.
export function isFrameUsable(capturedAt: number, receivedAt: number, now: number) {
  return capturedAt > 0 && receivedAt >= capturedAt && now >= receivedAt && now - capturedAt <= 1000 && now - receivedAt <= 500;
}
