import { canRenderProvisional, distanceReference, radiusFromImageWidth } from '../fitting/braceletSizing';
import type { AutoFitResult, WidthMeasurement } from '../../models/fitting.types';
import { dot, rotate, quaternionAngle } from '../geometry/wristGeometry';
import type { WristPose } from '../../models/wrist.types';
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export const LIVE_CALIBRATION_RETENTION_MS = 1500;


/** Chỉ cho camera: size nội tại là radius / distance reference không thứ nguyên, không phải pixel hay mm. Scale sản phẩm/Manual Fit nằm ngoài lớp này. */
export class LiveWristSizer {
  private intrinsic: number | null = null;
  private reference: WristPose | null = null;
  private lastObserved = 0;
  private lastUpdate = 0;
  private samples: number[] = [];
  private lastSample = 0;
  private sampleView: WristPose | null = null;
  private estimated = false;
  private confirmed = false;
  private targetIntrinsic: number | null = null;
  reset() { this.intrinsic = this.targetIntrinsic = null; this.reference = this.sampleView = null; this.lastObserved = this.lastUpdate = this.lastSample = 0; this.samples = []; this.estimated = this.confirmed = false; }
  missing(time: number) {
    if (time - this.lastSample > 1800) this.samples = [];
    if (time < this.lastObserved || time - this.lastObserved > LIVE_CALIBRATION_RETENTION_MS) this.reset();
  }
  update(pose: WristPose, measurement: WidthMeasurement, time: number, options: { roi?: boolean; auto?: boolean; fixedSize?: boolean; allowEstimate?: boolean } = {}): AutoFitResult {
    if (options.fixedSize) return { pose: null, method: 'blocked', quality: 0, message: 'True-to-Size cần kích thước sản phẩm và hiệu chuẩn mm.' };
    const distance = distanceReference(pose);
    const waiting = (): AutoFitResult => ({ pose: null, method: 'measuring', quality: 0, message: 'Đã thấy cổ tay nhưng chưa có phép đo biên đủ chắc chắn; giữ rõ hai mép cổ tay.' });
    if (!distance || !Number.isFinite(time)) return waiting();
    if (!options.roi && (time < this.lastObserved || time - this.lastObserved > LIVE_CALIBRATION_RETENTION_MS)) this.reset();
    if (!options.roi) this.lastObserved = time;
    const dt = this.lastUpdate ? Math.min(.2, Math.max(0, (time - this.lastUpdate) / 1000)) : 0;
    this.lastUpdate = time;
    if (options.auto === false) { this.intrinsic ??= pose.radius / distance; this.targetIntrinsic = this.intrinsic; this.confirmed = true; this.estimated = false; }
    const normal = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
    const incidence = Math.abs(dot(normal, pose.center)) / Math.hypot(pose.center.x, pose.center.y, pose.center.z);
    // Không hiệu chuẩn tiết diện ellipse giả định từ lòng bàn tay nhìn cạnh.
    // Giữ bán kính phiên; xoay tay không thay đổi giải phẫu.
    const sameView = !this.reference || equivalentViewAngle(this.reference, pose) < .26;
    const trusted = !options.roi && options.auto !== false && incidence > .65 && sameView &&
      measurement.width !== null && measurement.confidence >= .8 && (measurement.sampleCount ?? 0) >= 5;
    const observedRadius = !options.roi && measurement.width !== null && measurement.confidence >= .8 && (measurement.sampleCount ?? 0) >= 5 ? radiusFromImageWidth(pose, measurement.width) : null;
    const radius = trusted ? observedRadius : null;
    if (this.intrinsic === null && options.allowEstimate && !options.roi && canRenderProvisional({ ...pose, radius: observedRadius ?? pose.radius })) {
      // Hand hợp lệ có thể bắt đầu khi chưa có khuỷu tay hoặc ba frame biên da;
      // đây là kích thước ước lượng, chưa phải Auto Fit đo được.
      this.intrinsic = (observedRadius ?? pose.radius) / distance; this.estimated = true;
    }
    let measured = false;
    if (radius) {
      const candidate = radius / distance;
      if (time - this.lastSample > 1800 || (this.sampleView && equivalentViewAngle(this.sampleView, pose) > .26) || (this.samples.length && Math.abs(Math.log(candidate / median(this.samples))) > .08)) this.samples = [];
      if (!this.samples.length) this.sampleView = pose;
      this.lastSample = time;
      this.samples.push(candidate); if (this.samples.length > 4) this.samples.shift();
      if (this.samples.length >= 3) {
        const target = median(this.samples);
        if (this.intrinsic === null) this.intrinsic = target;
        this.reference ??= pose;
        this.targetIntrinsic = target;
        this.confirmed = true;
        measured = true;
      }
    } else if (time - this.lastSample > 1800) this.samples = [];
    if (this.intrinsic === null) return waiting();
    if (this.targetIntrinsic !== null) {
      // Hoàn tất chuyển tiếp tới target đã xác nhận kể cả khi mất biên mới
      // hoặc cổ tay xoay khỏi góc calibration; không fit lại size theo góc.
      const log = Math.log(this.targetIntrinsic / this.intrinsic), step = Math.max(-.18 * dt, Math.min(.18 * dt, log));
      this.intrinsic *= Math.exp(step);
      if (Math.abs(log - step) < .03) this.estimated = false;
    }
    measured = measured && !this.estimated;
    const provisional = this.estimated || !this.confirmed;
    const fitted = { ...pose, radius: this.intrinsic * distance, calibrationRadius: provisional ? undefined : this.intrinsic, distanceScale: distance };
    return {
      pose: fitted, method: options.auto === false ? 'manual' : provisional ? 'provisional' : options.roi ? 'predictive' : measured ? 'image' : 'calibrated',
      quality: measured ? measurement.confidence : 0,
      message: provisional ? 'Đã xác định cổ tay · kích thước vòng đang ước lượng, chưa xác nhận Auto Fit.' : options.roi ? 'Tiếp tục bằng điểm ảnh cổ tay trong thời gian giới hạn; cần bàn tay để xác nhận hướng 3D.' : measured ? 'Đã đo biên cổ tay và tự khớp vòng minh họa; chưa phải kích thước mm.' : 'Giữ hiệu chuẩn; theo dõi khoảng cách bằng bàn tay, không đổi kích thước theo biên yếu hoặc góc xoay.',
    };
  }
}


/** Only Lumière's existing half-turn symmetry, not arbitrary jewellery. */
export function equivalentViewAngle(a: WristPose, b: WristPose) {
  const q = b.orientation, halfTurn = { x: q.y, y: -q.x, z: q.w, w: -q.z };
  return Math.min(quaternionAngle(a.orientation, q), quaternionAngle(a.orientation, halfTurn));
}
