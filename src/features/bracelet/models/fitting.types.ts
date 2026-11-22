import type { ImageMeasurementDebug } from './imageCoordinates';

import type { WristPose } from './wrist.types';
/** Cả hai trục của điểm ảnh đều dùng đơn vị theo BỀ RỘNG ảnh, giống project(). */
export type MeasurementPoint = { x: number; y: number };

export type EdgeCandidate = {
  point: MeasurementPoint; side: -1 | 1; distancePx: number; quality: number;
  rejected: boolean; reason: string;
};

export type MeasurementSlice = {
  center: MeasurementPoint; candidates: EdgeCandidate[];
  left?: MeasurementPoint; right?: MeasurementPoint;
  accepted: boolean; reason: string;
};

export type WidthMeasurement = {
  width: number | null; confidence: number; reason: string;
  rawWidth?: number; sampleCenter?: { x: number; y: number };
  sampleCount?: number; spread?: number; contrast?: number; contourResidual?: number;
  left?: MeasurementPoint; right?: MeasurementPoint;
  slices?: MeasurementSlice[]; analysisWidth?: number;
  image?: ImageMeasurementDebug;
};

export type FitMethod = 'image' | 'manual-edges' | 'provisional' | 'calibrated' | 'predictive' | 'manual' | 'measuring' | 'blocked';

export type SizingDebug = {
  method: FitMethod; message: string; confidence: number;
  estimatedWristDiameter: number; wristMinorDiameter: number;
  braceletInnerDiameter: number; braceletInnerMinorDiameter: number;
  baseScale: number; manualFitMultiplier: number; finalWorldScale: number;
  projectedBraceletDiameterPx: number; estimatedWristWidthPx: number;
  observedWristWidthPx: number | null; baseWristWidthPx: number;
  frameWidth: number;
  fitRatio: number | null; autoScale: number; finalRenderScale: number;
  fitMode: 'Visual Auto Fit';
  status: 'measured' | 'provisional' | 'calibrated' | 'predictive' | 'rejected' | 'manual';
  rawWristWidthPx: number | null;
  acceptedSlices: number; rejectedCandidates: number;
  proxyWorldScale: number; braceletWorldScale: number;
  calibrationRadius: number | null; distanceScale: number;
  wristRadius: number; braceletRadius: number;
  effectiveFitMultiplier: number; collisionLimited: boolean;
  imageMeasurement?: ImageMeasurementDebug;
  nativeWristWidthPx: number | null; nativeBraceletWidthPx: number | null;
};


export type AutoFitOptions = { auto?: boolean; video?: boolean; policy?: 'visual-auto' | 'fixed-size'; trackingSource?: 'Hand' | 'ROI'; input?: 'image' | 'camera' };

export type AutoFitResult = { pose: WristPose | null; method: FitMethod; message: string; quality: number };
