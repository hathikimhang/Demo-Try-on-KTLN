import type { WristPose } from '../../models/wrist.types';
import { add, sub, mul, length, rotate, quaternionAngle, slerp } from '../geometry/wristGeometry';
import { wristAnchor } from '../live/liveWristFrame';

/** Experimental presentation layer only. Input is existing V1 placement/sizing.
 * No new size/depth estimates. Missing evidence never increases confidence.
 * Hold means the entire matched IMAGE+pose, never old pose on a newer video. */
export class LiveV2Continuity {
  private pose: WristPose | null = null;
  private capturedAt = -Infinity;
  private receivedAt = -Infinity;
  private lastInput = -Infinity;
  private good = 0;
  private lost = true;
  private everPresented = false;
  private lastConfidence = 0;
  private reason = 'no-observation';
  filterResetCount = 0;
  raw: WristPose | null = null;
  static readonly holdMs = 200;
  static readonly fadeMs = 40;
  reset() { this.pose = this.raw = null; this.capturedAt = this.receivedAt = this.lastInput = -Infinity; this.good = 0; this.lost = true; this.everPresented = false; this.reason = 'reset'; this.filterResetCount = 0; }
  private expire(now: number) {
    if (this.pose && !this.lost && (now - this.receivedAt >= LiveV2Continuity.holdMs + LiveV2Continuity.fadeMs || now - this.capturedAt > 1000)) {
      this.pose = null; this.good = 0; this.lost = true; this.filterResetCount++;
    }
  }
  update(raw: WristPose | null, capturedAt: number, receivedAt: number, usable: boolean, confidence: number, rejectReason: string) {
    if (!Number.isFinite(capturedAt + receivedAt) || capturedAt <= this.lastInput) return { accepted: false, ignored: true, pose: null };
    this.expire(receivedAt); this.lastInput = capturedAt; this.raw = raw;
    if (!usable || receivedAt < capturedAt || receivedAt - capturedAt > 1000 || !raw || raw.radius <= 0 || raw.center.z <= .02 || ![raw.center.x, raw.center.y, raw.center.z, raw.radius, raw.orientation.x, raw.orientation.y, raw.orientation.z, raw.orientation.w].every(Number.isFinite)) {
      this.good = 0; this.reason = !usable ? 'unusable-input' : rejectReason;
      return { accepted: false, ignored: false, pose: null };
    }
    this.good++;
    // A lone valid pulse after LOST must not flash the mesh back on.
    if (this.lost && this.good < 2) { this.reason = 'confirming-reacquisition'; return { accepted: false, ignored: false, pose: null }; }
    const previous = this.pose;
    let next = raw;
    if (previous && previous.aspect === raw.aspect) {
      const dt = Math.max(.001, (capturedAt - this.capturedAt) / 1000);
      const alpha = 1 - Math.exp(-dt / .025); // 25ms time constant; no extrapolation.
      const angle = quaternionAngle(previous.orientation, raw.orientation);
      const q = slerp(previous.orientation, raw.orientation, Math.max(alpha, angle > 1e-8 ? 1 - .035 / angle : 1));
      const anchor = add(mul(wristAnchor(previous), 1 - alpha), mul(wristAnchor(raw), alpha));
      let center = add(anchor, mul(rotate(q, { x: 0, y: 0, z: 1 }), raw.palmLength * .25));
      const error = sub(center, raw.center), maxError = raw.radius * .1; // <=5% wrist diameter from supplied pose.
      if (length(error) > maxError) center = add(raw.center, mul(error, maxError / length(error)));
      next = { ...raw, center, orientation: q }; // Radius/calibration copied exactly.
    }
    this.pose = next; this.capturedAt = capturedAt; this.receivedAt = receivedAt;
    this.lastConfidence = confidence; this.lost = false; this.everPresented = true; this.reason = 'current-observation';
    return { accepted: true, ignored: false, pose: next };
  }
  read(now: number) {
    this.expire(now);
    const age = now - this.receivedAt;
    const opacity = this.pose ? Math.max(0, Math.min(1, 1 - (age - LiveV2Continuity.holdMs) / LiveV2Continuity.fadeMs)) : 0;
    const missing = this.reason !== 'current-observation';
    return {
      pose: this.pose, capturedAt: this.capturedAt, receivedAt: this.receivedAt,
      visible: !!this.pose && opacity > 0, opacity,
      state: !this.pose ? this.everPresented ? 'LOST' : 'ACQUIRING' : missing || age > LiveV2Continuity.holdMs || this.lastConfidence < .75 ? 'DEGRADED' : 'TRACKING',
      reason: !this.pose ? this.reason === 'confirming-reacquisition' ? this.reason : 'tracking-lost' : age > LiveV2Continuity.holdMs ? 'matched-frame-fade' : missing ? 'matched-frame-grace' : 'current-observation',
      confidence: missing ? 0 : this.lastConfidence,
      filterResetCount: this.filterResetCount, poseAgeMs: this.pose ? now - this.capturedAt : null,
      filterErrorScene: this.raw && this.pose ? length(sub(this.pose.center, this.raw.center)) : null,
    };
  }
}
