import type { Point } from '../../../../shared/types/vision';
import type { WristEngineEstimate, WristEngineObservation } from '../../models/wristEngine.types';
import type { Quaternion, V3 } from '../../models/wrist.types';
import { cross, dot, length, sub, unit } from '../geometry/wristGeometry';
import { wristFrame } from '../live/liveWristFrame';

const finite = (p: Point | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const world = (p: Point | undefined): p is Point & V3 => finite(p) && Number.isFinite(p!.z);
const visible = (p: Point | undefined) => world(p) && (p.visibility ?? 0) >= .7;

/** Raw geometry POC. No sizing, calibration, smoothing or V1 pose input.
 * OBSERVED means supported by current model observations, not ground-truth 3D. */
export class WristTrackingEngineV2 {
  private previous: Quaternion | undefined;
  private lastTime = -Infinity;
  private depthAt: number | null = null;
  reset() { this.previous = undefined; this.lastTime = -Infinity; this.depthAt = null; }
  update(o: WristEngineObservation, now = o.timestamp): WristEngineEstimate {
    const out: WristEngineEstimate = {
      frameId: o.frameId, timestamp: o.timestamp, width: o.width, height: o.height, focal: o.focal,
      hand0: null, anchor: null, anchorState: 'UNCONFIRMED', anchorReason: 'no-hand',
      anchorExtrapolated: false, wearCenter: null, axis2D: null, axis3D: null, orientation: null,
      orientationState: 'UNCONFIRMED', orientationSource: 'None', reason: 'no-hand',
      axis2DSource: 'None', confidence2D: 0, confidence3D: 0,
      depthAgeMs: this.depthAt === null ? null : Math.max(0, o.timestamp - this.depthAt), contourLine: null,
    };
    const reject = (reason: string) => { out.reason = reason; return out; };
    if (![o.frameId, o.timestamp, now, o.width, o.height, o.focal].every(Number.isFinite) || o.width <= 0 || o.height <= 0 || o.focal <= 0) return reject('invalid-frame');
    if (o.timestamp <= this.lastTime) return reject('out-of-order');
    if (now < o.timestamp || now - o.timestamp > 1000) return reject('stale-frame');
    if (o.timestamp - this.lastTime > 1000) this.previous = undefined;
    this.lastTime = o.timestamp;
    const h = o.hand[0], aspect = o.height / o.width;
    if (!finite(h) || h.x < 0 || h.x > 1 || h.y < 0 || h.y > 1) { this.previous = undefined; return reject('no-hand'); }
    const h0 = { x: h.x, y: h.y * aspect };
    out.hand0 = h0; out.anchor = h0; out.anchorState = 'ESTIMATED'; out.anchorReason = 'Hand0-reference-only';
    // Project Hand0 onto the observed centerline. Outside its support interval is
    // explicitly extrapolation; never call this an observed anatomical wear center.
    const c = o.contour;
    if (c?.direction && c.confidence >= .75 && c.line && c.sections.length >= 6) {
      const [a, b] = c.line, dx = b.x - a.x, dy = b.y - a.y, n2 = dx * dx + dy * dy;
      if ([a.x, a.y, b.x, b.y, c.confidence].every(Number.isFinite) && n2 > 1e-8) {
        const t = ((h0.x - a.x) * dx + (h0.y - a.y) * dy) / n2;
        const d = Math.hypot(c.direction.x, c.direction.y);
        if (Number.isFinite(d) && d > 1e-8) {
          out.axis2D = { x: c.direction.x / d, y: c.direction.y / d };
          out.axis2DSource = c.source; out.confidence2D = Math.min(1, c.confidence); out.contourLine = c.line;
          out.anchorExtrapolated = t < 0 || t > 1;
          // Do not extend a line beyond the length of its observed support.
          if (t >= -1 && t <= 2) {
            out.anchor = { x: a.x + t * dx, y: a.y + t * dy };
            out.anchorState = out.anchorExtrapolated ? 'ESTIMATED' : 'OBSERVED';
            out.anchorReason = out.anchorExtrapolated ? 'centerline-extrapolation-at-Hand0' : 'centerline-supported-at-Hand0';
          } else out.anchorReason = 'centerline-too-far-for-extrapolation';
        }
      }
    }
    // Associate in IMAGE space. Never subtract Hand world positions from Pose world.
    const palm = [5, 9, 13, 17].filter(i => finite(o.hand[i])).map(i => o.hand[i]);
    const span = palm.length === 4 ? Math.hypot(palm.reduce((s, p) => s + p.x / 4, 0) - h0.x, palm.reduce((s, p) => s + p.y * aspect / 4, 0) - h0.y) : 0;
    if (span < .025) return reject('hand-frame-degenerate');
    const matches = [[13, 15], [14, 16]].flatMap(([elbow, wrist]) => {
      const e = o.pose[elbow], w = o.pose[wrist], ew = o.poseWorld[elbow], ww = o.poseWorld[wrist];
      if (![e, w, ew, ww].every(visible)) return [];
      if ([e, w].some(p => p.x < .01 || p.x > .99 || p.y < .01 || p.y > .99)) return [];
      const gap = Math.hypot(w.x - h.x, (w.y - h.y) * aspect);
      return gap <= span * .65 ? [{ e, w, ew: ew as V3, ww: ww as V3, gap, quality: Math.min(e.visibility ?? 0, w.visibility ?? 0, ew.visibility ?? 0, ww.visibility ?? 0) }] : [];
    }).sort((a, b) => a.gap - b.gap);
    if (!matches.length) return reject('forearm-depth-unobserved');
    if (matches.length > 1 && matches[1].gap - matches[0].gap < span * .25) return reject('ambiguous-arm-match');
    const { e, w, ew, ww } = matches[0], wd = sub(ew, ww);
    const dx = e.x - w.x, dy = (e.y - w.y) * aspect, xy = Math.hypot(wd.x, wd.y), screen = Math.hypot(dx, dy);
    if (xy < .045 || length(wd) < .1 || length(wd) > .55 || screen < span * .8) return reject('pose-axis-degenerate');
    // Same relative image camera convention as V1; this is not metric depth.
    const z = unit({ x: dx, y: dy, z: wd.z * screen / xy });
    if (out.axis2D && (dx * out.axis2D.x + dy * out.axis2D.y) / screen < .8) return reject('pose-contour-disagreement');
    out.axis3D = z; this.depthAt = o.timestamp; out.depthAgeMs = 0;
    out.orientationSource = 'Pose-image-XY+Pose-world-relative-depth';
    // Fit world Hand XY to image Hand XY, using only differences within Hand.
    let a = 0, b = 0, den = 0;
    if (![0, 5, 9, 13, 17].every(i => world(o.handWorld[i]) && finite(o.hand[i]))) return reject('hand-roll-unobserved');
    for (const i of [5, 9, 13, 17]) {
      const wx = o.handWorld[i].x - o.handWorld[0].x, wy = o.handWorld[i].y - o.handWorld[0].y;
      const ix = o.hand[i].x - h0.x, iy = o.hand[i].y * aspect - h0.y;
      a += wx * ix + wy * iy; b += wx * iy - wy * ix; den += wx * wx + wy * wy;
    }
    if (den < 1e-5 || Math.hypot(a, b) < 1e-8) return reject('hand-roll-degenerate');
    const residual = Math.sqrt([5, 9, 13, 17].reduce((sum, i) => {
      const wx = o.handWorld[i].x - o.handWorld[0].x, wy = o.handWorld[i].y - o.handWorld[0].y;
      return sum + ((a * wx - b * wy) / den - (o.hand[i].x - h0.x)) ** 2 + ((b * wx + a * wy) / den - (o.hand[i].y * aspect - h0.y)) ** 2;
    }, 0) / 4) / span;
    if (residual > .24) return reject('hand-reprojection-inconsistent');
    const scale = Math.hypot(a, b) / den, transverse = sub(o.handWorld[5] as V3, o.handWorld[17] as V3);
    const across = { x: (a * transverse.x - b * transverse.y) / den, y: (b * transverse.x + a * transverse.y) / den, z: transverse.z * scale };
    // Do not transport old roll through degeneracy in this raw POC.
    if (length(cross(z, across)) / Math.max(length(across), 1e-10) < .25) return reject('local-frame-degenerate');
    const basis = wristFrame(z, across);
    if (!basis) return reject('local-frame-degenerate');
    let q = basis.orientation;
    // q and -q encode the same rotation; no old quaternion hold or arbitrary yaw.
    if (this.previous && dot(q, this.previous) + q.w * this.previous.w < 0) q = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    out.orientation = q; this.previous = q;
    out.orientationState = 'OBSERVED'; out.confidence3D = Math.min(1, matches[0].quality);
    out.orientationSource += '+Hand-roll';
    out.reason = 'current-model-supported-relative-3D';
    return out;
  }
}
