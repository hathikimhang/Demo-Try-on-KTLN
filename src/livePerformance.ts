import { project, quaternionAngle, type WristPose } from './wristGeometry';

type Sample = { at: number; value: number };
const stats = (samples: Sample[], since: number) => {
  const v = samples.filter(s => s.at >= since).map(s => s.value).sort((a, b) => a - b);
  return { count: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, p95: v[Math.min(v.length - 1, Math.floor(v.length * .95))] ?? null, max: v.at(-1) ?? null };
};
/** Bounded numeric developer telemetry, no pixels, no network, no React state.
 * FPS means observed events, not requestAnimationFrame target refresh rate.
 * Worker/GL timings are CPU durations, NOT hardware GPU completion times. */
export class LivePerformance {
  private samples = new Map<string, Sample[]>();
  private startedAt = 0;
  private lastResult = 0;
  private lastCameraFrames: number | undefined;
  private previousPose: WristPose | null = null;
  private previousState = '';
  private lastLog = 0;
  private cameraFrames = 0;
  private submittedFrames = 0;
  pending = 0;
  maxPending = 0;
  dropped = 0;
  duplicates = 0;
  transitions: { at: number; from: string; to: string }[] = [];
  observationThread = 'unknown';
  reset(at: number) { this.samples.clear(); this.startedAt = at; this.lastResult = this.lastLog = 0; this.lastCameraFrames = undefined; this.previousPose = null; this.previousState = ''; this.pending = this.maxPending = this.dropped = this.duplicates = this.cameraFrames = this.submittedFrames = 0; this.transitions = []; this.observationThread = 'unknown'; }
  add(name: string, at: number, value = 1) {
    if (!Number.isFinite(at + value)) return;
    let list = this.samples.get(name); if (!list) this.samples.set(name, list = []);
    list.push({ at, value }); while (list.length && (list[0].at < at - 5000 || list.length > 400)) list.shift();
  }
  camera(at: number, presentedFrames?: number) {
    const count = presentedFrames !== undefined && this.lastCameraFrames !== undefined ? Math.max(1, presentedFrames - this.lastCameraFrames) : 1;
    this.add('camera', at, count);
    this.cameraFrames += count;
    if (presentedFrames !== undefined) { if (this.lastCameraFrames !== undefined) this.dropped += Math.max(0, count - 1); this.lastCameraFrames = presentedFrames; }
  }
  request(at: number) { this.pending++; this.submittedFrames++; this.maxPending = Math.max(this.maxPending, this.pending); this.add('request', at); }
  result(at: number, inferenceMs: number) {
    this.pending = Math.max(0, this.pending - 1); this.add('result', at); this.add('inferenceMs', at, inferenceMs);
    if (this.lastResult) this.add('poseIntervalMs', at, at - this.lastResult); this.lastResult = at;
  }
  pose(at: number, pose: WristPose | null, state: string, width: number) {
    if (this.previousState && state !== this.previousState) { this.transitions.push({ at, from: this.previousState, to: state }); if (this.transitions.length > 100) this.transitions.shift(); }
    this.previousState = state;
    if (pose && this.previousPose) {
      this.add('angularDeltaRadians', at, quaternionAngle(this.previousPose.orientation, pose.orientation));
      const a = project(this.previousPose.center, this.previousPose), b = project(pose.center, pose);
      this.add('centerDeltaPx', at, Math.hypot(a.x - b.x, a.y - b.y) * width);
      this.add('logScaleDelta', at, Math.abs(Math.log(pose.radius / this.previousPose.radius)));
    }
    this.previousPose = pose;
  }
  snapshot(now: number) {
    const since = Math.max(this.startedAt, now - 2000), seconds = Math.max(.001, (now - since) / 1000);
    const fps = (name: string) => (this.samples.get(name) ?? []).filter(s => s.at >= since).reduce((sum, s) => sum + s.value, 0) / seconds;
    const result: Record<string, unknown> = { version: 'live-performance-1', observationThread: this.observationThread, windowMs: now - since, cameraFPS: fps('camera'), inferenceFPS: fps('result'), compositeFPS: fps('composite'), webglFPS: fps('webgl'), pendingRequests: this.pending, maxPendingRequests: this.maxPending, droppedCameraFrames: Math.max(0, this.cameraFrames - this.submittedFrames), busyCallbacks: this.dropped, duplicateCallbacks: this.duplicates, trackingState: this.previousState, trackingTransitions: this.transitions.slice(-10) };
    for (const name of ['inferenceMs', 'handMs', 'armMs', 'skinMs', 'observationMs', 'mainUpdateMs', 'renderMs', 'bitmapMs', 'captureToPresentMs', 'sensorToPresentMs', 'poseIntervalMs', 'angularDeltaRadians', 'centerDeltaPx', 'logScaleDelta']) result[name] = stats(this.samples.get(name) ?? [], since);
    return result;
  }
  log(now: number, enabled: boolean) { if (enabled && now - this.lastLog >= 1000) { this.lastLog = now; console.debug('[mira-perf]', JSON.stringify(this.snapshot(now))); } }
}
