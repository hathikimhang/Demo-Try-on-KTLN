export type LiveState = 'ACQUIRING' | 'TRACKING' | 'DEGRADED' | 'LOST';
export type LivePresentation = 'current' | 'hold' | 'hidden';
export const LIVE_GRACE_MS = 300;
export const LIVE_PIPELINE_VERSION = 'wrist-first-continuity-1';
export type ContinuityDecision = { status: LiveState; presentation: LivePresentation; holdUntil: number; ignored: boolean };

/** A grace interval holds the LAST IMAGE together with its pose. It never
 * authorizes drawing an old pose over a newer image. Recovery hysteresis
 * affects the state label, not whether a valid current frame is displayed. */
export class LiveContinuity {
  private lastInput = -Infinity;
  private lastGoodAt = -Infinity;
  private consecutiveGood = 0;
  private everPresented = false;
  private decision: ContinuityDecision = { status: 'ACQUIRING', presentation: 'hidden', holdUntil: 0, ignored: false };
  reset() { this.lastInput = this.lastGoodAt = -Infinity; this.consecutiveGood = 0; this.everPresented = false; this.decision = { status: 'ACQUIRING', presentation: 'hidden', holdUntil: 0, ignored: false }; }
  update(capturedAt: number, now: number, valid: boolean, reliable: boolean, usable: boolean, provisional = false): ContinuityDecision {
    if (!Number.isFinite(capturedAt + now) || capturedAt <= this.lastInput) return { ...this.decision, ignored: true };
    this.lastInput = capturedAt;
    if (!usable) { this.consecutiveGood = 0; return this.decision = { status: this.everPresented ? 'LOST' : 'ACQUIRING', presentation: 'hidden', holdUntil: 0, ignored: false }; }
    if (valid) {
      this.lastGoodAt = now; this.everPresented = true;
      this.consecutiveGood = reliable && !provisional ? this.consecutiveGood + 1 : 0;
      const status = provisional ? 'ACQUIRING' : this.consecutiveGood >= 2 ? 'TRACKING' : 'DEGRADED';
      return this.decision = { status, presentation: 'current', holdUntil: now + LIVE_GRACE_MS, ignored: false };
    }
    this.consecutiveGood = 0;
    const holdUntil = this.lastGoodAt + LIVE_GRACE_MS;
    const hold = this.everPresented && now < holdUntil;
    return this.decision = { status: hold ? 'DEGRADED' : this.everPresented ? 'LOST' : 'ACQUIRING', presentation: hold ? 'hold' : 'hidden', holdUntil: hold ? holdUntil : 0, ignored: false };
  }
}
