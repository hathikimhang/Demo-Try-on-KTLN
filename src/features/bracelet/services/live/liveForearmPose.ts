import { axisAngle, axisFromScreen, placeOnForearm, wristAnchor, wristFrame } from './liveWristFrame';
import { clamp, dot, rotate, unit } from '../geometry/wristGeometry';
import type { WristPose, V3, Quaternion, ForearmContour, LiveOrientation, ForearmSource } from '../../models/wrist.types';
/** Phân biệt pháp tuyến mặt phẳng theo cẳng tay và roll theo bề ngang lòng bàn tay. Foreground contour không phải cảm biến depth 3D; gập theo Z mơ hồ chỉ được giữ ngắn rồi từ chối, không đoán yaw. */
export class LiveForearmEstimator {
  private orientation: Quaternion | undefined;
  private axis: V3 | null = null;
  private seedHandAxis: V3 | null = null;
  private lastHandAxis: V3 | null = null;
  private depthZ = 0;
  private poseDepthAt = -Infinity;
  private observedAt = -Infinity;
  private time = 0;
  private depthUncertainAt: number | null = null;
  private twistUncertainAt: number | null = null;
  private depthCandidate: V3 | null = null;
  private depthConfirmations = 0;
  private depthCandidateAt = 0;
  private forearmInHand: V3 | null = null;
  get needsArmConfirmation() { return this.depthConfirmations > 0 && this.depthConfirmations < 3; }
  get needsArmObservation() { return this.needsArmConfirmation || this.depthUncertainAt !== null || this.twistUncertainAt !== null; }
  reset() { this.orientation = undefined; this.axis = this.seedHandAxis = this.lastHandAxis = this.depthCandidate = this.forearmInHand = null; this.depthZ = this.time = this.depthCandidateAt = this.depthConfirmations = 0; this.poseDepthAt = this.observedAt = -Infinity; this.depthUncertainAt = this.twistUncertainAt = null; }
  missing(time: number) { if (time - this.time > 1500 || time < this.time) this.reset(); }
  update(hand: WristPose, contour: ForearmContour | null, now: number, arm?: WristPose | null, armQuality = .9): LiveOrientation {
    const handAxis = rotate(hand.orientation, { x: 0, y: 0, z: 1 }), palmNormal = rotate(hand.orientation, { x: 0, y: 1, z: 0 }), anchor = wristAnchor(hand);
    let source: ForearmSource = 'None', confidence = 0, depth: LiveOrientation['depth'] = 'assumed-straight';
    const reject = (reason: string): LiveOrientation => ({ pose: null, source, confidence: 0, depth, reason, handAxis, forearmAxis: null, palmNormal, wristAnchor: anchor });
    if (!Number.isFinite(now) || (this.time && now <= this.time)) return reject('orientation-out-of-order');
    this.missing(now);
    this.seedHandAxis ??= handAxis;
    let axis: V3 | null = null;
    let observedArm = arm;
    let pendingDepth = false;
    if (observedArm && this.axis) {
      const target = rotate(observedArm.orientation, { x: 0, y: 0, z: 1 });
      if (Math.abs(Math.asin(clamp(target.z, -1, 1)) - Math.asin(clamp(this.depthZ, -1, 1))) > .22) {
        const coherent = this.depthCandidate && now - this.depthCandidateAt <= 750 && axisAngle(this.depthCandidate, target) < .15;
        this.depthConfirmations = coherent ? this.depthConfirmations + 1 : 1; this.depthCandidate = target; this.depthCandidateAt = now;
        // Một Pose depth spike bị loại không được làm sai độ sâu của các frame
        // contour sau đó; yêu cầu nhiều kết quả Pose mới liên tiếp để xác nhận.
        if (this.depthConfirmations < 3) { observedArm = null; pendingDepth = true; }
      } else { this.depthConfirmations = 0; this.depthCandidate = null; }
    }
    if (observedArm) {
      axis = rotate(observedArm.orientation, { x: 0, y: 0, z: 1 });
      this.depthZ = axis.z; this.poseDepthAt = now; this.depthUncertainAt = null;
      source = 'Pose'; confidence = Math.min(.98, Math.max(0, armQuality)); depth = 'Pose'; this.observedAt = now; this.depthConfirmations = 0; this.depthCandidate = null;
    } else if (contour?.direction && contour.confidence >= .75) {
      if (!this.axis) {
        if (Math.abs(dot(handAxis, unit(anchor))) > .72) return reject('initial-forearm-depth-unobserved');
        this.depthZ = handAxis.z; // Khởi tạo với giả định cổ tay thẳng được ghi rõ.
      }
      depth = now - this.poseDepthAt <= 750 ? 'held-Pose' : 'assumed-straight';
      const unknownDepth = Math.abs(Math.asin(clamp(handAxis.z, -1, 1)) - Math.asin(clamp(this.depthZ, -1, 1))) > .22;
      if (depth === 'assumed-straight' && unknownDepth) {
        this.depthUncertainAt ??= now;
        if (now - this.depthUncertainAt > 500) return reject('unobserved-forearm-depth');
        confidence = .5;
      } else { this.depthUncertainAt = null; confidence = contour.confidence; }
      axis = axisFromScreen(contour.direction, this.depthZ, anchor);
      source = contour.source; this.observedAt = now;
    } else if (this.axis && now - this.observedAt <= 300) {
      // Chỉ giữ lịch sử hướng/basis, neo vào Hand0 HIỆN TẠI.
      // Giới hạn thời gian ngắn; vị trí vẫn do Hand0 hiện tại cung cấp.
      axis = this.axis; source = 'temporal-axis'; confidence = .5;
    } else {
      // Fallback cận cảnh dùng giả định cổ tay thẳng/cứng được công bố.
      // Quan hệ local học từ cẳng tay đã quan sát đi theo chuyển động/roll Hand,
      // không phải quan sát khuỷu tay hoặc depth mới.
      axis = this.forearmInHand ? rotate(hand.orientation, this.forearmInHand) : handAxis;
      this.depthZ = axis.z; source = this.forearmInHand ? 'hand-calibrated' : 'hand-assumption'; confidence = this.forearmInHand ? .55 : .4;
    }
    if (!axis) return reject('forearm-projection-degenerate');
    const axial = Math.abs(dot(axis, unit(anchor)));
    if (axial > .86 || ((source === 'hand-assumption' || source === 'hand-calibrated') && axial > .72)) return reject('forearm-axial-view');
    if (pendingDepth) confidence = Math.min(confidence, .5);
    const across = rotate(hand.orientation, { x: 1, y: 0, z: 0 }), basis = wristFrame(axis, across, this.orientation);
    if (!basis) return reject('forearm-basis-degenerate');
    if (basis.transported) {
      this.twistUncertainAt ??= now;
      if (now - this.twistUncertainAt > 350) return reject('wrist-roll-unobserved');
      confidence = Math.min(confidence, .5);
    } else this.twistUncertainAt = null;
    if ((source === 'Pose' || source === 'contour-rgb' || source === 'contour-segmentation') && confidence >= .75 && !basis.transported) {
      const q = hand.orientation;
      this.forearmInHand = rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, axis);
    }
    this.axis = axis; this.orientation = basis.orientation; this.lastHandAxis = handAxis; this.time = now;
    // Giữ định danh tracking mode được yêu cầu; một Pose bổ sung thưa
    // không được reset filter/calibration như khi người dùng đổi chế độ.
    const pose = placeOnForearm(hand, axis, basis.orientation);
    return { pose, source, confidence, depth, reason: pendingDepth ? 'pose-depth-pending' : confidence >= .75 ? 'ok' : 'orientation-assumed', handAxis, forearmAxis: axis, palmNormal, wristAnchor: anchor, basisCondition: basis.condition, transportedRoll: basis.transported };
  }
}
