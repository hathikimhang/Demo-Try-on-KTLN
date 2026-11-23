import type { Point, SkinSegmentation } from '../../../../shared/types/vision';
import type { NativeRoi } from '../../models/imageCoordinates';
import type { WristPose } from '../../models/wrist.types';
import { measureForearmContour } from '../live/liveForearmContour';

/** V2-only scan around the actual Hand0 plane, not the distal forearm.
 * Scan distances are sampling coverage in palm spans, never placement offsets.
 * Hand/Pose direction only seeds pixel search; it is NOT returned as an observation. */
export function measureWristAnchorContour(roi: NativeRoi, pose: WristPose, hand: readonly Point[], arm: readonly Point[], skin?: SkinSegmentation) {
  const h = hand[0], aspect = roi.imageHeight / roi.imageWidth;
  const valid = (p: Point | undefined) => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!valid(h) || ![5, 9, 13, 17].every(i => valid(hand[i]))) return null;
  const anchor = { x: h.x, y: h.y * aspect };
  let dx = h.x - [5, 9, 13, 17].reduce((s, i) => s + hand[i].x / 4, 0);
  let dy = h.y * aspect - [5, 9, 13, 17].reduce((s, i) => s + hand[i].y * aspect / 4, 0);
  const span = Math.hypot(dx, dy);
  if (span < .025) return null;
  const matches = [[13, 15], [14, 16]].flatMap(([e, w]) => {
    if (![arm[e], arm[w]].every(p => valid(p) && (p.visibility ?? 0) >= .7 && p.x > .01 && p.x < .99 && p.y > .01 && p.y < .99)) return [];
    const gap = Math.hypot(arm[w].x - h.x, (arm[w].y - h.y) * aspect);
    return gap <= span * .65 ? [{ e, w, gap }] : [];
  }).sort((a, b) => a.gap - b.gap);
  let searchSource = 'Hand-search-prior';
  if (matches.length && (matches.length === 1 || matches[1].gap - matches[0].gap >= span * .25)) {
    const { e, w } = matches[0]; dx = arm[e].x - arm[w].x; dy = (arm[e].y - arm[w].y) * aspect; searchSource = 'Pose-image-search-prior';
  }
  const n = Math.hypot(dx, dy); if (n < 1e-8) return null;
  const along = { x: dx / n, y: dy / n }, transverse = { x: along.y, y: -along.x };
  const sampling = { frame: { anchor, along, transverse, span }, firstAlong: -.24, stepAlong: .04 };
  const semantic = skin ? measureForearmContour(roi, pose, h, skin, sampling) : null;
  const contour = semantic?.direction ? semantic : measureForearmContour(roi, pose, h, undefined, sampling);
  return { contour, searchSource, roi: { x: roi.x, y: roi.y, width: roi.width, height: roi.height, imageWidth: roi.imageWidth, imageHeight: roi.imageHeight } };
}
