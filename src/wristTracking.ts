import type { TrackingMode } from './types';
import { dot, rotate, type WristPose, type WristMetrics, type WristReason } from './wristGeometry';
import type { AutoFitResult } from './braceletSizing';

export type TrackingState = 'tracking' | 'low-confidence' | 'lost';
export type TrackingReason = WristReason | 'stale' | 'reacquiring' | 'mode-switch' | 'render-error' | 'sizing' | 'roi-lost' | 'orientation';
export type TrackingSource = 'Hand Landmarker' | 'Hand Landmarker + Pose' | 'ROI' | 'Grace frame' | 'None';
export type TrackingSnapshot = {
  state: TrackingState; reason: TrackingReason; metrics: WristMetrics;
  mode: TrackingMode; landmarks: number; radius?: number;
  source: TrackingSource; phase: 'initial' | 'continuous';
  roi?: { matches: number; inliers: number; rms: number | null; ageMs: number; quality: number };
  roiSeed?: { ready: boolean; points: number; candidates: number; distributed: boolean };
  viewAngle?: number;
  requestedMode?: TrackingMode; workerMode?: TrackingMode; fallbackReason?: WristReason;
};
export const emptyTracking = (): TrackingSnapshot => ({ state: 'lost', reason: 'no-hand', metrics: {}, mode: 'straight-wrist', landmarks: 0, source: 'None', phase: 'initial' });
export function wristViewAngle(pose: WristPose) {
  const normal = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
  // The bangle basis has a valid half-turn symmetry. Absolute incidence avoids
  // reporting a fake 180-degree jump when the equivalent basis is selected.
  return Math.acos(Math.max(0, Math.min(1, Math.abs(dot(normal, pose.center)) / Math.hypot(pose.center.x, pose.center.y, pose.center.z)))) * 180 / Math.PI;
}

// A result with its exact image may be older than one frame on a slow CPU.
// Distinguish slow inference from a stalled worker, while bounding both ages.
export function isFrameUsable(capturedAt: number, receivedAt: number, now: number) {
  return capturedAt > 0 && receivedAt >= capturedAt && now >= receivedAt && now - capturedAt <= 1000 && now - receivedAt <= 500;
}

export function trackingMessage(reason: TrackingReason) {
  switch (reason) {
    case 'no-hand': case 'roi-lost': return 'Đưa bàn tay và cổ tay trở lại khung để nhận diện. ROI chỉ tiếp tục khi cổ tay có đủ dữ liệu ảnh.';
    case 'no-forearm': case 'arm-match': return 'Đã thấy bàn tay — để lộ cả khuỷu tay và cổ tay, hoặc bật cận cảnh';
    case 'arm-direction': return 'Chưa xác định chắc hướng cẳng tay — để lộ khuỷu tay và cổ tay';
    case 'orientation': return 'Chưa đủ dữ liệu hướng cẳng tay — giữ rõ cổ tay và một đoạn cẳng tay.';
    case 'axial-view': return 'Cẳng tay hướng gần vào camera — xoay nhẹ sang bên';
    case 'cropped': case 'bounds': return 'Cổ tay sát mép — đưa tay vào giữa và lùi ra một chút';
    case 'scale': return 'Đưa bàn tay vừa khung hình và giữ rõ cổ tay';
    case 'fit': case 'degenerate': case 'invalid-data': return 'Tư thế chưa đủ rõ — giữ cổ tay thẳng và giảm che khuất';
    case 'stale': return 'Di chuyển chậm và giữ rõ bàn tay, cổ tay trong khung hình';
    case 'reacquiring': return 'Đang xác nhận lại tư thế — giữ tay ổn định';
    case 'mode-switch': return 'Đang cập nhật chế độ nhận diện';
    case 'sizing': return 'Đang đo biên cổ tay để tự khớp vòng';
    case 'render-error': return 'Không hiển thị được đồ họa 3D';
    default: return 'Đã nhận diện bàn tay';
  }
}

/** Upload messages describe the failed stage, not camera instructions. */
export function uploadTrackingMessage(reason: TrackingReason, hasHand: boolean, fit?: Pick<AutoFitResult, 'method' | 'message'>) {
  if (reason === 'mode-switch') return 'Đang cập nhật chế độ phân tích ảnh; chờ kết quả đúng chế độ đã chọn.';
  if (!hasHand || reason === 'no-hand') return 'Không phát hiện bàn tay trong ảnh: Hand Landmarker không trả về landmark bàn tay.';
  if (reason === 'render-error') return 'Đã xác định cổ tay nhưng WebGL không hiển thị được vòng. Kiểm tra tăng tốc đồ họa của trình duyệt.';
  if (fit) {
    if (fit.method === 'provisional') return `${fit.message} Chọn hai mép để hiệu chuẩn; che khuất dùng proxy hình học ước lượng.`;
    if (fit.method === 'image') return 'Auto Fit thành công: đã xác định cổ tay và ước lượng kích thước hiển thị từ biên ảnh; chưa phải số đo mm.';
    if (fit.method === 'manual-edges') return 'Đã hiển thị vòng theo hai mép bạn chọn (calibration thủ công); không phải kết quả Auto Fit hay số đo mm.';
    if (fit.method === 'manual') return 'Đã xác định cổ tay; đang hiển thị vòng bằng Manual Calibration, chưa xác nhận kích thước bằng Auto Fit.';
    if (fit.method === 'calibrated') return 'Đã xác định cổ tay; đang hiển thị vòng theo calibration đã có, chưa chấp nhận phép đo biên mới.';
    return fit.message.startsWith('Đã xác định cổ tay') ? fit.message : `Đã xác định cổ tay nhưng chưa đo được kích thước để hiển thị vòng. ${fit.message}`;
  }
  const details: Partial<Record<TrackingReason, string>> = {
    'invalid-data': 'Thiếu hoặc không hợp lệ ở landmark cổ tay/MCP hay dữ liệu Hand 3D.',
    degenerate: 'Các mốc bàn tay không tạo được hệ trục cổ tay độc lập.',
    bounds: 'Tâm vòng hoặc vùng cổ tay ước lượng nằm ngoài giới hạn ảnh.',
    cropped: 'Landmark cổ tay hoặc MCP cần thiết nằm ngoài ảnh.',
    scale: 'Các mốc 2D/3D không đủ điều kiện xác định tỷ lệ.',
    fit: 'Landmark 2D và Hand 3D không khớp đủ tin cậy.',
    'axial-view': 'Trục cẳng tay gần hướng camera nên tư thế không xác định chắc.',
    'arm-direction': 'Hướng cẳng tay từ Pose không nhất quán với bàn tay; không tự bỏ qua lỗi hình học này.',
    'no-forearm': 'Không có dữ liệu Pose phù hợp và chưa có wrist pose an toàn.',
    'arm-match': 'Pose không khớp với bàn tay đang phân tích.',
  };
  return `Phát hiện bàn tay nhưng không xác định được tư thế cổ tay. ${details[reason] ?? 'Chưa có wrist pose hợp lệ.'} Mã kỹ thuật: ${reason}.`;
}
