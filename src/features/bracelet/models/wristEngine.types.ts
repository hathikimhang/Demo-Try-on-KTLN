import type { Point } from '../../../shared/types/vision';
import type { ForearmContour, Quaternion, V3 } from './wrist.types';
import type { ImagePoint } from './imageCoordinates';

export type WristEngineMode = 'v1' | 'v2' | 'compare';
export type EvidenceState = 'OBSERVED' | 'ESTIMATED' | 'UNCONFIRMED';
/** Unmirrored input. Image points use x/W, y/W; MediaPipe inputs retain x/W,y/H.
 * Pose/Hand world origins are independent: only within-model differences are used.
 * focal is the existing virtual camera's focal/W, NOT calibrated sensor intrinsics. */
export type WristEngineObservation = {
  frameId: number; timestamp: number; width: number; height: number; focal: number;
  hand: readonly Point[]; handWorld: readonly Point[];
  pose: readonly Point[]; poseWorld: readonly Point[];
  contour: ForearmContour | null;
};
export type WristEngineEstimate = {
  frameId: number; timestamp: number; width: number; height: number; focal: number;
  hand0: ImagePoint | null;
  anchor: ImagePoint | null; anchorState: EvidenceState; anchorReason: string;
  anchorExtrapolated: boolean; wearCenter: null;
  axis2D: ImagePoint | null; axis3D: V3 | null; orientation: Quaternion | null;
  orientationState: EvidenceState; orientationSource: string; reason: string;
  axis2DSource: string; confidence2D: number; confidence3D: number; depthAgeMs: number | null;
  contourLine: [ImagePoint, ImagePoint] | null;
};
