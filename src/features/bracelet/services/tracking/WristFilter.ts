import type { WristPose, V3 } from '../../models/wrist.types';
import { quaternionAngle, length, sub, add, mul, unit, clamp, slerp } from '../geometry/wristGeometry';
/** Filter vị trí, log-scale và quaternion theo thời gian thực, không nội suy Euler. Cutoff thích nghi và giới hạn lag tránh làm vòng kéo đuôi trên da. */
export class WristFilter {
  private pose: WristPose | null = null;
  private timestamp = 0;
  private candidate: WristPose | null = null;
  private confirmations = 0;
  private distanceSamples: number[] = [];
  private primeDistance(pose: WristPose) { this.distanceSamples = pose.distanceScale ? Array(3).fill(pose.distanceScale) : []; }
  reset() { this.pose = null; this.timestamp = 0; this.candidate = null; this.confirmations = 0; this.distanceSamples = []; }
  update(target: WristPose | null, now: number): WristPose | null {
    if (!target) { this.reset(); return null; }
    const previous = this.pose, dt = (now - this.timestamp) / 1000;
    if (previous && dt > 0 && dt <= .25 && previous.source === target.source && previous.handedness === target.handedness) {
      const q = target.orientation;
      const equivalent = { x: q.y, y: -q.x, z: q.w, w: -q.z }; // q nhân phép xoay nửa vòng quanh Z local.
      if (quaternionAngle(previous.orientation, equivalent) < quaternionAngle(previous.orientation, q)) target = { ...target, orientation: equivalent };
    }
    this.timestamp = now;
    if (!previous || dt <= 0 || dt > 0.25 || previous.source !== target.source || Math.abs(previous.aspect - target.aspect) > 0.001) {
      this.candidate = null; this.confirmations = 0;
      this.primeDistance(target);
      this.pose = target; return target;
    }
    const handChanged = !!previous.handedness && !!target.handedness && previous.handedness !== target.handedness;
    const jump = handChanged || length(sub(target.center, previous.center)) > target.radius * 3 || quaternionAngle(previous.orientation, target.orientation) > 1.1;
    if (jump) {
      const coherent = this.candidate && this.candidate.handedness === target.handedness && length(sub(this.candidate.center, target.center)) < target.radius && quaternionAngle(this.candidate.orientation, target.orientation) < 0.35;
      this.confirmations = coherent ? this.confirmations + 1 : 1;
      this.candidate = target;
      if (this.confirmations < 3) return null; // Ẩn bước nhảy chưa xác nhận, không snap tới vị trí mới.
      this.pose = target; this.primeDistance(target); this.candidate = null; this.confirmations = 0; return target;
    }
    this.candidate = null; this.confirmations = 0;
    const alpha = (cutoff: number) => 1 - Math.exp(-2 * Math.PI * cutoff * dt);
    const speed = length(sub(target.center, previous.center)) / target.radius / dt;
    let center = mix(previous.center, target.center, alpha(1.6 + Math.min(14, speed * 0.22)));
    const lag = sub(center, target.center), maxLag = target.radius * 0.12;
    if (length(lag) > maxLag) center = add(target.center, mul(unit(lag), maxLag));
    const scaleSpeed = Math.abs(Math.log(target.radius / previous.radius)) / dt;
    const a = alpha(1.4 + Math.min(10, scaleSpeed));
    // Giới hạn thay đổi so với size đã render trước, không so target mới.
    // Clamp theo target ±6% trước đây vẫn cho phần lớn bước nhảy nhiễu đi qua.
    const logStep = clamp(Math.log(target.radius / previous.radius) * a, -1.8 * dt, 1.8 * dt);
    const radius = previous.radius * Math.exp(logStep);
    const angle = quaternionAngle(previous.orientation, target.orientation);
    let orientation = slerp(previous.orientation, target.orientation, alpha(1.7 + Math.min(12, angle / dt)));
    const rotationLag = quaternionAngle(orientation, target.orientation);
    if (rotationLag > 0.18) orientation = slerp(orientation, target.orientation, 1 - 0.18 / rotationLag);
    let distanceScale: number | undefined;
    if (target.distanceScale !== undefined) {
      this.distanceSamples.push(target.distanceScale); if (this.distanceSamples.length > 3) this.distanceSamples.shift();
      const sorted = [...this.distanceSamples].sort((x, y) => x - y), targetDistance = sorted[Math.floor(sorted.length / 2)];
      const before = previous.distanceScale ?? targetDistance;
      const speed = Math.abs(Math.log(targetDistance / before)) / dt;
      const step = clamp(Math.log(targetDistance / before) * alpha(3 + Math.min(8, speed)), -1.8 * dt, 1.8 * dt);
      distanceScale = before * Math.exp(step);
    }
    this.pose = { ...target, center, radius, distanceScale, palmLength: previous.palmLength * (1 - a) + target.palmLength * a, orientation };
    return this.pose;
  }
}

const mix = (a: V3, b: V3, t: number) => add(mul(a, 1 - t), mul(b, t));
