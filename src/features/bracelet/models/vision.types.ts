import type { WristPose, LiveOrientation, ForearmContour, WristAnalysis, TrackingMode } from './wrist.types';
import type { WidthMeasurement } from './fitting.types';
import type { ImageMask } from './imageCoordinates';
import type { PixelFrame } from './tracking.types';
import type { Point, SkinSegmentation } from '../../../shared/types/vision';
export type LiveObservation = {
  hand: WristAnalysis; pose: WristPose | null;
  orientation: LiveOrientation | null; contour: ForearmContour | null;
  measurement: WidthMeasurement; mask: ImageMask | null; pixels: PixelFrame | null;
  needsArmObservation: boolean;
};

export type LiveObservationInput = { points: Point[]; worldPoints: Point[]; armPoints: Point[]; armWorldPoints: Point[]; handedness: string; skin?: SkinSegmentation; timestamp: number; mode: TrackingMode };

export type BraceletDetection = {
points: Point[];
worldPoints: Point[];
handedness: string;
armPoints: Point[];
armWorldPoints: Point[];
elapsed: number;
timestamp: number;
trackingMode: TrackingMode;
skin?: SkinSegmentation;
armStatus?: string;
pipelineVersion?: string;
liveObservation?: LiveObservation;
timings?: { handMs: number; armMs: number; skinMs: number; observationMs: number };
};
