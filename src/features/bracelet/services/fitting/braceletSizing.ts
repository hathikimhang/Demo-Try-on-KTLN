import { rotate, add, project, dot } from '../geometry/wristGeometry';
import type { WristPose } from '../../models/wrist.types';
import { FOREARM, WRIST_MODEL_RADIUS, BANGLE, BANGLE_INNER_RADIUS } from '../../models/braceletDimensions';
import type { WidthMeasurement, AutoFitOptions, AutoFitResult } from '../../models/fitting.types';
export function widthAxis(pose: WristPose) {
  const axis = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  const x = axis.x * pose.center.z - pose.center.x * axis.z;
  const y = axis.y * pose.center.z - pose.center.y * axis.z;
  const n = Math.hypot(x, y);
  return n > 1e-8 ? { x: y / n, y: -x / n } : { x: 1, y: 0 };
}

/** Chiếu phối cảnh tiết diện mặt phẳng vòng trong cùng hệ theo bề rộng ảnh với CV và camera Three.js. */
export function projectedSpan(pose: WristPose, radius: number, modelRadius: number, oval: number) {
  const axis = widthAxis(pose); let min = Infinity, max = -Infinity;
  for (let i = 0; i < 96; i++) {
    const theta = i / 96 * Math.PI * 2;
    const p = add(pose.center, rotate(pose.orientation, { x: radius * modelRadius * Math.cos(theta), y: radius * modelRadius * oval * Math.sin(theta), z: 0 }));
    if (p.z <= 0.01) return null;
    const screen = project(p, pose), t = screen.x * axis.x + screen.y * axis.y;
    min = Math.min(min, t); max = Math.max(max, t);
  }
  const center = project(pose.center, pose), origin = center.x * axis.x + center.y * axis.y;
  return {
    width: max - min,
    left: { x: center.x + axis.x * (min - origin), y: center.y + axis.y * (min - origin) },
    right: { x: center.x + axis.x * (max - origin), y: center.y + axis.y * (max - origin) },
  };
}

export function projectedWidth(pose: WristPose, radius: number, modelRadius: number, oval: number) {
  return projectedSpan(pose, radius, modelRadius, oval)?.width ?? NaN;
}

export function radiusFromImageWidth(pose: WristPose, width: number) {
  if (!(width > 0) || !Number.isFinite(width) || !(pose.radius > 0) || !(pose.palmLength > 0) || !Number.isFinite(pose.radius + pose.palmLength + pose.center.z)) return null;
  const arm = rotate(pose.orientation, { x: 0, y: 0, z: 1 });
  const view = Math.abs(dot(arm, pose.center)) / Math.hypot(pose.center.x, pose.center.y, pose.center.z);
  if (view > .85) return null; // Không fit ngược từ lát cắt dọc trục hoặc mơ hồ.
  const u = rotate(pose.orientation, { x: 1, y: 0, z: 0 }), v = rotate(pose.orientation, { x: 0, y: 1, z: 0 });
  const depthExtent = WRIST_MODEL_RADIUS * Math.hypot(u.z, v.z * FOREARM.oval);
  // Giới hạn hợp lý rộng theo giải phẫu, không phải hệ số tăng size; giữ cổ tay
  // xa điểm kỳ dị projection, thay cho giới hạn cũ cho phép độ sâu tới 80%.
  const safeMax = Math.min(pose.palmLength * 1.25, (pose.center.z - 0.02) / Math.max(0.01, depthExtent) * 0.2);
  if (!(safeMax > 0)) return null;
  let lo = 0, hi = Math.min(pose.radius, safeMax);
  // Mở rộng tìm kiếm tới bề rộng đo được, thay vì áp trần hiệu chỉnh prior
  // gấp bốn lần một ước lượng bàn tay vốn có thể quá nhỏ.
  while (hi < safeMax && projectedWidth(pose, hi, WRIST_MODEL_RADIUS, FOREARM.oval) < width) hi = Math.min(safeMax, hi * 1.6);
  const upperWidth = projectedWidth(pose, hi, WRIST_MODEL_RADIUS, FOREARM.oval);
  if (!Number.isFinite(upperWidth) || upperWidth < width) return null;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (projectedWidth(pose, mid, WRIST_MODEL_RADIUS, FOREARM.oval) < width) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

const median = (values: number[]) => {
  const a = [...values].sort((a, b) => a - b), m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};


/** Kiểm tra khả năng render, không xác nhận độ chính xác phép đo. Pose Hand đã được kiểm chứng có thể dùng size ước lượng khi trạng thái provisional được công bố rõ. */
export function canRenderProvisional(pose: WristPose) {
  const values = [...Object.values(pose.center), ...Object.values(pose.orientation), pose.radius, pose.palmLength, pose.focal, pose.aspect];
  if (!values.every(Number.isFinite) || pose.radius <= 0 || pose.palmLength <= 0 || pose.focal <= 0 || pose.aspect <= 0 || pose.center.z <= .02) return false;
  if (Math.abs(Math.hypot(...Object.values(pose.orientation)) - 1) > .01) return false;
  const span = projectedSpan(pose, pose.radius, BANGLE_INNER_RADIUS, BANGLE.oval), center = project(pose.center, pose);
  return !!span && Number.isFinite(span.width) && span.width > 0 && center.x > 0 && center.x < 1 && center.y > 0 && center.y < pose.aspect &&
    [span.left, span.right].every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= pose.aspect);
}


/** Phiên giữ một bán kính nội tại tương đối với span lòng bàn tay. Khoảng cách đổi scale scene; góc xoay đổi hình chiếu, không đổi calibration. Kích thước Hand model chưa phải thước đo vật lý. */
export function distanceReference(pose: WristPose) {
  const scale = pose.distanceScale ?? pose.palmLength;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export class WristSizer {
  private intrinsic: number | null = null;
  private previous: WristPose | null = null;
  private lastTime = 0;
  private samples: number[] = [];
  reset() { this.intrinsic = null; this.previous = null; this.lastTime = 0; this.samples = []; }
  loseTracking() { this.reset(); }
  // Chỉ giữ calibration vô hướng khi nhận diện mất ngắn, không trả về
  // pose cũ để render. Mất lâu hoặc đổi bàn tay thì phải khởi tạo lại.
  missing(time: number) {
    this.samples = [];
    if (time - this.lastTime > 1500 || time < this.lastTime) this.reset();
  }
  update(pose: WristPose, measurement: WidthMeasurement, time: number, options: AutoFitOptions = {}): AutoFitResult {
    if (options.policy === 'fixed-size') return { pose: null, method: 'blocked', quality: 0, message: 'True-to-Size cần size sản phẩm và hiệu chuẩn mm; không tự phóng mẫu vòng fixed-size.' };
    // Ảnh tĩnh có phép đo biên hoặc calibration thủ công mới, không kế thừa
    // calibration camera theo thời gian; đo lại thất bại không được giữ nhãn thành công cũ.
    if (options.input === 'image') this.reset();
    const scale = distanceReference(pose), previous = this.previous;
    const changed = previous && ((previous.handedness && pose.handedness && previous.handedness !== pose.handedness) || previous.source !== pose.source || Math.hypot(previous.center.x - pose.center.x, previous.center.y - pose.center.y) > pose.palmLength * 1.8 || time - this.lastTime > 1500 || time < this.lastTime);
    if (changed) this.reset();
    this.previous = pose; this.lastTime = time;
    const waiting = (message: string): AutoFitResult => ({ pose: null, method: 'measuring', quality: 0, message });
    if (!scale) return waiting(options.input === 'image' ? 'Đã xác định cổ tay nhưng chuẩn tỷ lệ landmark không hợp lệ để dựng vòng an toàn (invalid-scale).' : 'Không có dữ liệu khoảng cách đáng tin cậy; đưa bàn tay trở lại khung hình.');
    const output = (): WristPose => ({ ...pose, radius: this.intrinsic! * scale, calibrationRadius: this.intrinsic!, distanceScale: scale });
    if (options.input === 'image' && measurement.image?.method === 'manual-edges' && measurement.width !== null) {
      const radius = radiusFromImageWidth(pose, measurement.width);
      if (!radius) return waiting('Hai mép đã chọn cho kích thước ngoài miền hình học an toàn (manual-width-out-of-range).');
      this.intrinsic = radius / scale;
      return { pose: output(), method: 'manual-edges', quality: 1, message: 'Đã hiệu chuẩn bề rộng từ hai mép bạn chọn trên ảnh gốc. Đây là calibration thủ công, không phải Auto Fit hay số đo mm.' };
    }
    if (options.auto === false) {
      this.intrinsic ??= pose.radius / scale;
      return { pose: output(), method: 'manual', quality: 0, message: 'Manual Calibration: giữ kích thước cơ sở trong phiên; Manual Fit chỉ thay vòng, không thay proxy hoặc tracking.' };
    }
    // ROI chỉ duy trì fit đã có, không tự tạo calibration 3D.
    const measured = options.trackingSource !== 'ROI' && measurement.width !== null && measurement.confidence >= .65 ? radiusFromImageWidth(pose, measurement.width) : null;
    if (options.input === 'image' && measured) {
      this.intrinsic = measured / scale;
      return { pose: output(), method: 'image', quality: measurement.confidence, message: 'Visual Auto Fit: dùng bề rộng đo trên ROI ảnh gốc; chưa phải True-to-Size theo mm.' };
    }
    if (this.intrinsic !== null) {
      const fitted = output();
      const agrees = measured !== null && Math.abs(Math.log(measured / fitted.radius)) < .12;
      return {
        pose: fitted, method: agrees ? 'image' : 'calibrated', quality: agrees ? measurement.confidence : 0,
        message: agrees ? 'Biên phù hợp calibration. Giữ bán kính phiên; chỉ cập nhật tỷ lệ theo khoảng cách.' : 'Giữ calibration trong phiên; không đổi bán kính theo biên yếu/góc xoay. Đưa bàn tay trở lại nếu tracking mất.',
      };
    }
    if (!measured) {
      this.samples = [];
      if (options.input === 'image' && options.trackingSource !== 'ROI') {
        const reason = measurement.width !== null && measurement.confidence >= .65 ? 'Phép đo biên cho bán kính ngoài miền hình học an toàn.' : measurement.reason;
        if (!canRenderProvisional(pose)) return waiting(`Đã xác định cổ tay nhưng chưa đo được kích thước. Kích thước ban đầu không thể chiếu an toàn lên ảnh (unsafe-provisional). ${reason}`);
        // Không ghi nhận calibration nội tại từ anatomical prior.
        // Phép đo hợp lệ về sau vẫn phải thay được kích thước tạm này.
        return { pose: { ...pose, calibrationRadius: undefined }, method: 'provisional', quality: 0,
          message: `Đã hiển thị vòng với kích thước tạm tính (Provisional Fit), chưa đo được biên cổ tay. ${reason} Có thể điều chỉnh Manual Fit; đây chưa phải Auto Fit chính xác.` };
      }
      return waiting(`${measurement.reason}. Auto Fit đang chờ biên rõ để hiệu chuẩn; có thể tắt Dynamic Auto Fit để dùng Manual Calibration.`);
    }
    const candidate = measured / scale;
    if (this.samples.length && Math.abs(Math.log(candidate / median(this.samples))) > .12) this.samples = [];
    this.samples.push(candidate); if (this.samples.length > 3) this.samples.shift();
    if (options.video && this.samples.length < 3) return waiting('Khởi tạo: giữ bàn tay và cổ tay trong khung, chờ ba frame biên rõ để hiệu chuẩn.');
    this.intrinsic = median(this.samples);
    return { pose: output(), method: 'image', quality: measurement.confidence, message: 'Đã hiệu chuẩn Visual Auto Fit; kích thước cơ sở được giữ trong phiên, không phải số đo mm.' };
  }
}
