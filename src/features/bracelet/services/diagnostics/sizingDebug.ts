import { BANGLE, BANGLE_CLEARANCE_SCALE, BANGLE_INNER_RADIUS, FOREARM, WRIST_MODEL_RADIUS, finalWorldScale, manualFit } from '../../models/braceletDimensions';
import type { WristPose } from '../../models/wrist.types';
import type { WidthMeasurement, FitMethod, SizingDebug } from '../../models/fitting.types';
import { projectedWidth, distanceReference } from '../fitting/braceletSizing';
export function sizingDebug(pose: WristPose, multiplier: number, frameWidth: number, measurement: WidthMeasurement, method: FitMethod, message: string, renderFit = multiplier): SizingDebug {
  const fit = manualFit(renderFit), ready = ['image', 'manual-edges', 'provisional', 'calibrated', 'manual', 'predictive'].includes(method);
  const final = ready ? finalWorldScale(pose.radius, fit) : 0;
  const innerPixels = ready ? projectedWidth(pose, final, BANGLE_INNER_RADIUS, BANGLE.oval) * frameWidth : 0;
  return {
    method, message, confidence: measurement.confidence, frameWidth, fitMode: 'Visual Auto Fit',
    status: method === 'image' ? 'measured' : method === 'provisional' ? 'provisional' : method === 'calibrated' ? 'calibrated' : method === 'predictive' ? 'predictive' : method === 'manual' || method === 'manual-edges' ? 'manual' : 'rejected',
    effectiveFitMultiplier: fit, collisionLimited: fit > manualFit(multiplier) + 1e-8,
    imageMeasurement: measurement.image,
    nativeWristWidthPx: measurement.image && measurement.width !== null ? measurement.width * measurement.image.imageWidth : null,
    nativeBraceletWidthPx: measurement.image ? innerPixels / frameWidth * measurement.image.imageWidth : null,
    rawWristWidthPx: measurement.rawWidth === undefined ? null : measurement.rawWidth * frameWidth,
    acceptedSlices: measurement.slices?.filter(s => s.accepted).length ?? 0,
    rejectedCandidates: measurement.slices?.reduce((n, s) => n + s.candidates.filter(c => c.rejected).length, 0) ?? 0,
    proxyWorldScale: ready ? pose.radius : 0, braceletWorldScale: final * BANGLE_CLEARANCE_SCALE,
    calibrationRadius: pose.calibrationRadius ?? null, distanceScale: distanceReference(pose) ?? 0,
    wristRadius: ready ? WRIST_MODEL_RADIUS * pose.radius : 0, braceletRadius: BANGLE_INNER_RADIUS * final,
    autoScale: ready ? pose.radius : 0, finalRenderScale: final,
    fitRatio: measurement.width !== null && measurement.confidence >= .65 && (method === 'image' || method === 'manual' || method === 'manual-edges') ? innerPixels / (measurement.width * frameWidth) : null,
    // Ước lượng da/proxy độc lập với Manual Fit của vòng.
    estimatedWristDiameter: !ready ? 0 : 2 * WRIST_MODEL_RADIUS * pose.radius,
    wristMinorDiameter: !ready ? 0 : 2 * WRIST_MODEL_RADIUS * FOREARM.oval * pose.radius,
    braceletInnerDiameter: 2 * BANGLE_INNER_RADIUS * final,
    braceletInnerMinorDiameter: 2 * BANGLE_INNER_RADIUS * BANGLE.oval * final,
    baseScale: pose.radius, manualFitMultiplier: manualFit(multiplier), finalWorldScale: final,
    projectedBraceletDiameterPx: innerPixels,
    estimatedWristWidthPx: ready ? projectedWidth(pose, pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) * frameWidth : 0,
    baseWristWidthPx: projectedWidth(pose, pose.radius, WRIST_MODEL_RADIUS, FOREARM.oval) * frameWidth,
    observedWristWidthPx: measurement.width === null ? null : measurement.width * frameWidth,
  };
}
