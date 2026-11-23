import type { WristPose } from '../../models/wrist.types';
import type { ImageMask } from '../../models/imageCoordinates';
import { project, quaternionAngle } from '../geometry/wristGeometry';

export type StabilityObservation = {
  frameId: number | null; capturedAt: number; receivedAt: number;
  raw: WristPose | null; filtered: WristPose | null; source: string;
  trackingState: string; confidence: number; rejectReason: string;
  inferenceLatencyMs: number; mask: ImageMask | null;
};

/** Read-only diagnosis. Visibility means a mesh submitted for composition,
 * not proof its pixels survive depth/mask. No tracking or rendering decisions. */
export class LiveStabilityDiagnostics {
  private observation: StabilityObservation | null = null;
  private previous: StabilityObservation | null = null;
  private visible = false;
  private visibilityChanges = 0;
  private sourceChanges = 0;
  private signChanges = 0;
  reset() { this.observation = this.previous = null; this.visible = false; this.visibilityChanges = this.sourceChanges = this.signChanges = 0; }
  observe(input: StabilityObservation) {
    this.previous = this.observation; this.observation = input;
    if (this.previous && this.previous.source !== input.source) this.sourceChanges++;
    const a = this.previous?.raw?.orientation, b = input.raw?.orientation;
    if (a && b && a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0) this.signChanges++;
  }
  snapshot(now: number, visible: boolean, visibilityReason: string, perf: Record<string, unknown>, renderedAt: number | null) {
    const o = this.observation;
    if (visible !== this.visible) { this.visibilityChanges++; this.visible = visible; }
    const delta = (a: WristPose | null | undefined, b: WristPose | null | undefined) => {
      if (!a || !b || a.aspect !== b.aspect) return null;
      const p = project(a.center, a), q = project(b.center, b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    };
    let maskCoverage: number | null = null;
    if (o?.mask?.data.length) {
      const data = o.mask.data, step = Math.max(1, Math.floor(data.length / 512)); let covered = 0, n = 0;
      for (let i = 0; i < data.length; i += step) { n++; if (data[i] >= 128) covered++; }
      maskCoverage = covered / n;
    }
    return {
      version: 'stability-diagnostics-1', braceletEngine: 'v1', frameId: o?.frameId ?? null,
      poseAgeMs: o ? now - o.capturedAt : null, receivedAgeMs: o ? now - o.receivedAt : null,
      cameraFPS: perf.cameraFPS ?? null, inferenceFPS: perf.inferenceFPS ?? null,
      renderFPS: perf.webglFPS ?? null, compositeFPS: perf.compositeFPS ?? null,
      cpuTimings: { hand: perf.handMs, pose: perf.armMs, segmentation: perf.skinMs, observation: perf.observationMs, renderSubmission: perf.renderMs },
      gpuCompletionMs: null,
      inferenceLatencyMs: o?.inferenceLatencyMs ?? null, trackingState: o?.trackingState ?? 'ACQUIRING',
      confidence: o?.confidence ?? 0, rejectReason: o?.rejectReason ?? 'no-observation',
      braceletVisible: visible, visibilityChangeReason: visibilityReason, visibilityChangeCount: this.visibilityChanges,
      visibilityDefinition: 'mesh-submitted; pixel occlusion not measured',
      renderFrameTimestamp: renderedAt, observationTimestamp: o?.capturedAt ?? null,
      rawPosition: o?.raw?.center ?? null, filteredPosition: o?.filtered?.center ?? null,
      rawQuaternion: o?.raw?.orientation ?? null, filteredQuaternion: o?.filtered?.orientation ?? null,
      rawPositionDeltaImageWidth: delta(this.previous?.raw, o?.raw),
      filteredPositionDeltaImageWidth: delta(this.previous?.filtered, o?.filtered),
      rawAngularDeltaRadians: o?.raw && this.previous?.raw ? quaternionAngle(o.raw.orientation, this.previous.raw.orientation) : null,
      filteredAngularDeltaRadians: o?.filtered && this.previous?.filtered ? quaternionAngle(o.filtered.orientation, this.previous.filtered.orientation) : null,
      source: o?.source ?? 'None', sourceChangeCount: this.sourceChanges, rawQuaternionSignChangeCount: this.signChanges,
      maskPresent: !!o?.mask, maskCoverageSampled: maskCoverage,
      frameDropCount: perf.droppedCameraFrames ?? null, maxPendingRequests: perf.maxPendingRequests ?? null,
      filterResetCount: null as number | null, filterResetCountReason: 'V1 internal counter unavailable; V2 continuity counter is in its presentation trace',
    };
  }
}
