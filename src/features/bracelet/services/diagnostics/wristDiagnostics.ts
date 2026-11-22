import type { SizingDebug } from '../../models/fitting.types';
import type { TrackingSnapshot } from '../../models/tracking.types';
export function debugSample(time: number, tracking: TrackingSnapshot, sizing: SizingDebug | null, manual: number, live?: Record<string, unknown>) {
  return {
    ...(live ? { live } : {}),
    timestampMs: time, trackingStatus: tracking.state, trackingReason: tracking.reason,
    trackingSource: tracking.source, phase: tracking.phase, viewAngleDegrees: tracking.viewAngle ?? null,
    requestedTrackingMode: tracking.requestedMode ?? tracking.mode, workerTrackingMode: tracking.workerMode ?? tracking.mode,
    effectiveTrackingMode: tracking.mode, uploadFallbackReason: tracking.fallbackReason ?? null,
    roi: tracking.roi ?? null, roiSeed: tracking.roiSeed ?? null, manualFitMultiplier: manual,
    wristRadius: sizing?.wristRadius ?? null, braceletInnerRadius: sizing?.braceletRadius ?? null,
    calibrationRadiusRatio: sizing?.calibrationRadius ?? null, distanceScale: sizing?.distanceScale ?? null,
    finalBraceletWorldScale: sizing?.braceletWorldScale ?? null, wristProxyScale: sizing?.proxyWorldScale ?? null,
    wristProjectedWidthPx: sizing?.estimatedWristWidthPx ?? null, braceletProjectedWidthPx: sizing?.projectedBraceletDiameterPx ?? null,
    observedWristWidthPx: sizing?.observedWristWidthPx ?? null,
    measurementConfidence: sizing?.confidence ?? 0, fitStatus: sizing?.status ?? 'rejected', message: sizing?.message ?? '',
    imageMeasurement: sizing?.imageMeasurement ?? null,
    nativeWristWidthPx: sizing?.nativeWristWidthPx ?? null, nativeBraceletWidthPx: sizing?.nativeBraceletWidthPx ?? null,
    effectiveFitMultiplier: sizing?.effectiveFitMultiplier ?? manual, collisionLimited: sizing?.collisionLimited ?? false,
  };
}

/** Bộ đệm chỉ ở bộ nhớ và có giới hạn. Xuất log là tải cục bộ chủ động, không chứa dữ liệu ảnh. */
export class WristDebugLog {
  private rows: ReturnType<typeof debugSample>[] = [];
  append(row: ReturnType<typeof debugSample>) {
    this.rows.push(row); if (this.rows.length > 1800) this.rows.shift(); return this.rows.length;
  }
  reset() { this.rows = []; }
  serialize() { return JSON.stringify({ schemaVersion: 1, units: 'scene / normalized image; NOT mm', samples: this.rows }, null, 2); }
}
