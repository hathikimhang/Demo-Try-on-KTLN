import type { WristPose, WristReason, TrackingMode, WristMetrics } from './wrist.types';
export type PixelFrame = { width: number; height: number; data: Uint8ClampedArray };

export type Match = { from: P; to: P };

export type Similarity = { a: number; b: number; tx: number; ty: number };

export type RoiResult = { pose: WristPose | null; quality: number; matches: number; inliers: number; rms: number | null; ageMs: number; reason: string };

type P = { x: number; y: number };


export type TrackingState = 'tracking' | 'low-confidence' | 'lost';

export type TrackingReason = WristReason | 'stale' | 'reacquiring' | 'mode-switch' | 'render-error' | 'sizing' | 'roi-lost' | 'orientation';

export type TrackingSource = 'Hand Landmarker' | 'Hand Landmarker + Pose' | 'ROI' | 'Grace frame' | 'None';

export type TrackingSnapshot = {
  state: TrackingState; reason: TrackingReason; metrics: WristMetrics;
  mode: TrackingMode; landmarks: number; radius?: number;
  source: TrackingSource; phase: 'initial' | 'continuous';
  roi?: { matches: number; inliers: number; rms: number | null; ageMs: number; quality: number };
  roiSeed?: { ready: boolean; points: number; candidates: number; distributed: boolean };
  viewAngle?: number;
  requestedMode?: TrackingMode; workerMode?: TrackingMode; fallbackReason?: WristReason;
};

export const emptyTracking = (): TrackingSnapshot => ({ state: 'lost', reason: 'no-hand', metrics: {}, mode: 'straight-wrist', landmarks: 0, source: 'None', phase: 'initial' });
