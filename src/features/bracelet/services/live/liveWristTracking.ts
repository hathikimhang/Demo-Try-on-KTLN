import type { LiveState } from '../../models/liveContinuity';
import { dot, quaternionAngle, add, clamp, length, mul, sub, project } from '../geometry/wristGeometry';
import type { Quaternion, WristPose } from '../../models/wrist.types';
import { equivalentViewAngle, LIVE_CALIBRATION_RETENTION_MS, LiveWristSizer } from './liveWristSizing';
import { filterWristOrientation } from './liveWristFrame';
import type { WidthMeasurement } from '../../models/fitting.types';
import { WristRoiTracker } from '../tracking/wristRoiTracking';
import type { PixelFrame, RoiResult } from '../../models/tracking.types';
import type { ImageMask } from '../../models/imageCoordinates';
import { LiveContinuity } from '../../models/liveContinuity';
import { distanceReference, widthAxis } from '../fitting/braceletSizing';
export type { LiveState } from '../../models/liveContinuity';

const nearest = (previous: Quaternion, q: Quaternion) => {
  // Torus oval, dãy 22 đá và proxy hiện tại bất biến khi xoay π quanh Z local.
  // Không áp dụng quy tắc chọn nhánh này cho sản phẩm bất đối xứng.
  const half = { x: q.y, y: -q.x, z: q.w, w: -q.z };
  const chosen = quaternionAngle(previous, half) < quaternionAngle(previous, q) ? half : q;
  return dot(previous, chosen) + previous.w * chosen.w < 0 ? { x: -chosen.x, y: -chosen.y, z: -chosen.z, w: -chosen.w } : chosen;
};


/** Filter Live không reset khi loại observation. Ba quan sát nhất quán xác nhận bước nhảy phải được giữ qua các lần gọi. Ảnh vẫn dùng WristFilter với chính sách riêng. */
export class LiveWristFilter {
  private pose: WristPose | null = null;
  private time = 0;
  private candidate: WristPose | null = null;
  private confirmations = 0;
  private distances: number[] = [];
  identityChanged = false;
  rotationDelta = 0;
  reset() { this.pose = this.candidate = null; this.time = 0; this.confirmations = 0; this.distances = []; this.rotationDelta = 0; this.identityChanged = false; }
  update(raw: WristPose, time: number) {
    this.identityChanged = false;
    if (!Number.isFinite(time) || (this.pose && time <= this.time)) return null;
    if (this.pose && (time - this.time > LIVE_CALIBRATION_RETENTION_MS || Math.abs(raw.aspect - this.pose.aspect) > .001 || raw.source !== this.pose.source)) this.reset();
    const previous = this.pose;
    if (!previous) { this.pose = raw; this.time = time; this.distances = [raw.distanceScale ?? raw.palmLength]; return raw; }
    const target = { ...raw, orientation: nearest(previous.orientation, raw.orientation) };
    const positionJump = length(sub(previous.center, target.center)) > Math.max(previous.palmLength, target.palmLength) * 1.2;
    const angle = quaternionAngle(previous.orientation, target.orientation);
    if (positionJump || angle > 1.1) {
      const coherent = this.candidate && length(sub(target.center, this.candidate.center)) < target.radius && equivalentViewAngle(this.candidate, target) < .35;
      this.confirmations = coherent ? this.confirmations + 1 : 1; this.candidate = target;
      if (this.confirmations < 3) return null;
      // Xuất hiện lại ở vị trí khác cần đo size mới; thay đổi prior bán kính
      // hoặc nhãn handedness không đủ tin cậy để xác định đổi người.
      this.identityChanged = positionJump;
      this.pose = target; this.time = time; this.candidate = null; this.confirmations = 0;
      this.distances = [target.distanceScale ?? target.palmLength]; this.rotationDelta = angle;
      return target;
    }
    this.candidate = null; this.confirmations = 0;
    // Suy luận chậm nhưng còn mới không được bỏ continuity chỉ vì vượt 251ms.
    const dt = clamp((time - this.time) / 1000, .001, .12), alpha = (cutoff: number) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
    const speed = length(sub(target.center, previous.center)) / target.palmLength / dt;
    const a = alpha(2 + Math.min(12, speed));
    let center = add(mul(previous.center, 1 - a), mul(target.center, a));
    const lag = sub(center, target.center), maxLag = target.radius * .12;
    if (length(lag) > maxLag) center = add(target.center, mul(lag, maxLag / length(lag)));
    const orientation = filterWristOrientation(previous.orientation, target.orientation, alpha(2 + Math.min(12, angle / dt)), alpha(2 + Math.min(8, angle / dt)));
    if (!orientation) return null;
    this.rotationDelta = quaternionAngle(previous.orientation, orientation);
    const distance = target.distanceScale ?? target.palmLength;
    this.distances.push(distance); if (this.distances.length > 3) this.distances.shift();
    const observed = [...this.distances].sort((a, b) => a - b)[Math.floor(this.distances.length / 2)], before = previous.distanceScale ?? previous.palmLength;
    const log = Math.log(observed / before), step = clamp(log * alpha(5), -1.8 * dt, 1.8 * dt);
    this.pose = { ...target, center, orientation, distanceScale: before * Math.exp(step) };
    this.time = time;
    return this.pose;
  }
}


export class LiveWristSession {
  private filter = new LiveWristFilter();
  private placement = new LiveWristPlacement();
  private sizer = new LiveWristSizer();
  private roi = new WristRoiTracker(500, true, true);
  private lastHand = 0;
  private everTracked = false;
  private continuity = new LiveContinuity();
  private lastInput = -Infinity;
  status: LiveState = 'ACQUIRING';
  reset() { this.filter.reset(); this.placement.reset(); this.sizer.reset(); this.roi.reset(); this.continuity.reset(); this.lastInput = -Infinity; this.lastHand = 0; this.everTracked = false; this.status = 'ACQUIRING'; }
  missing(time: number) {
    this.sizer.missing(time);
    if (time - this.lastHand > LIVE_CALIBRATION_RETENTION_MS) { this.filter.reset(); this.placement.reset(); this.roi.reset(); this.status = this.everTracked ? 'LOST' : 'ACQUIRING'; }
    else this.status = this.everTracked ? 'DEGRADED' : 'ACQUIRING';
  }
  update(raw: WristPose | null, measurement: WidthMeasurement, pixels: PixelFrame | null, time: number, options: { usable: boolean; auto: boolean; fixedSize: boolean; orientationReliable?: boolean; foreground?: ImageMask | null; allowEstimate?: boolean; now?: number }) {
    if (!Number.isFinite(time) || time <= this.lastInput) return { tracked: null, fit: null, source: 'None' as const, roi: null, status: this.status, rotationDelta: this.filter.rotationDelta, seed: this.roi.seedEvidence, presentation: 'hidden' as const, holdUntil: 0, ignored: true };
    this.lastInput = time;
    let tracked = raw && options.usable ? this.filter.update(this.placement.update(raw, measurement, time), time) : null;
    let roi: RoiResult | null = null;
    let source: 'Hand' | 'ROI' | 'None' = tracked ? 'Hand' : 'None';
    if (tracked) {
      if (this.filter.identityChanged) { this.sizer.reset(); this.roi.reset(); this.placement.reset(); this.continuity.reset(); }
      this.lastHand = time;
    } else if (options.usable && pixels) {
      roi = this.roi.track(pixels, time); tracked = roi.pose;
      if (tracked) source = 'ROI';
    }
    if (!tracked) {
      // Giữ confirmation/calibration nhưng không vẽ pose cũ trên ảnh mới.
      // ROI cần correspondence thật, không chỉ dự đoán vận tốc.
      this.missing(time);
      const continuity = this.continuity.update(time, options.now ?? time, false, false, options.usable && !options.fixedSize);
      this.status = continuity.status;
      return { tracked: null, fit: null, source, roi, ...continuity, rotationDelta: this.filter.rotationDelta, seed: this.roi.seedEvidence };
    }
    const fit = this.sizer.update(tracked, measurement, time, { ...options, roi: source === 'ROI' });
    if (source === 'Hand' && pixels && fit.pose) {
      // Seed từ pose Hand đáng tin dù biên frame này yếu.
      // Seed mới thất bại không được xóa bằng chứng hợp lệ trước đó.
      const next = new WristRoiTracker(500, true, true); if (next.seed(pixels, fit.pose, time, options.foreground ?? undefined)) this.roi = next;
    }
    if (fit.pose) this.everTracked = true;
    const continuity = this.continuity.update(time, options.now ?? time, !!fit.pose, source === 'Hand' && options.orientationReliable !== false, options.usable && !options.fixedSize, fit.method === 'provisional');
    this.status = continuity.status;
    return { tracked, fit, source, roi, ...continuity, rotationDelta: this.filter.rotationDelta, seed: this.roi.seedEvidence };
  }
}


/** Đăng ký vị trí ngang từ biên native, độc lập orientation/sizing. Giữ hiệu chỉnh không thứ nguyên giữa các quan sát thưa và cập nhật theo chuyển động/khoảng cách Hand; không bật/tắt registration theo nhịp mask. */
export class LiveWristPlacement {
  private offset = 0;
  private time = 0;
  private measuredAt = 0;
  reset() { this.offset = this.time = this.measuredAt = 0; }
  update(pose: WristPose, m: WidthMeasurement, time: number) {
    const center = project(pose.center, pose), transverse = widthAxis(pose), distance = distanceReference(pose);
    if (!distance) return pose;
    const dt = this.time ? clamp((time - this.time) / 1000, 0, .2) : .1;
    this.time = time;
    if (m.width && m.confidence >= .85 && (m.sampleCount ?? 0) >= 5 && m.left && m.right) {
      const x = (m.left.x + m.right.x) / 2 - center.x, y = (m.left.y + m.right.y) / 2 - center.y;
      const lateral = x * transverse.x + y * transverse.y;
      if (Number.isFinite(lateral) && Math.abs(lateral) < m.width * .35) {
        const target = lateral / distance;
        this.offset += (target - this.offset) * (1 - Math.exp(-2 * Math.PI * 3 * dt)); this.measuredAt = time;
      }
    } else if (time - this.measuredAt > 1000) this.offset *= Math.exp(-dt * 2);
    const shift = this.offset * distance * pose.center.z / pose.focal;
    return { ...pose, center: { ...pose.center, x: pose.center.x + transverse.x * shift, y: pose.center.y + transverse.y * shift } };
  }
}
