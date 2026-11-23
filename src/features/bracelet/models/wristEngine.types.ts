import type { Point } from '../../../shared/types/vision';
import type { ForearmContour, Quaternion, V3 } from './wrist.types';
import type { ImagePoint, NativeRoi } from './imageCoordinates';

export type WristEngineMode = 'v1' | 'v2' | 'compare';
export type EvidenceState = 'OBSERVED' | 'ESTIMATED' | 'UNCONFIRMED';
export const WRIST_ENGINE_V2_VERSION = 'phase1-local-plane-2';
/** Unmirrored input. Image points use x/W, y/W; MediaPipe inputs retain x/W,y/H.
 * Pose/Hand world origins are independent: only within-model differences are used.
 * focal is the existing virtual camera's focal/W, NOT calibrated sensor intrinsics. */
export type WristEngineObservation = {
  frameId: number; timestamp: number; width: number; height: number; focal: number;
  hand: readonly Point[]; handWorld: readonly Point[];
  pose: readonly Point[]; poseWorld: readonly Point[];
  contour: ForearmContour | null; contourSearchSource?: string;
  contourRoi?: Omit<NativeRoi, 'data'> | null;
};
export type WristEngineEstimate = {
  engineVersion: string; trackingState: EvidenceState;
  coordinateSpace: 'unmirrored-x/W-y/W';
  frameId: number; timestamp: number; width: number; height: number; focal: number;
  hand0: ImagePoint | null;
  anchor: ImagePoint | null; anchorState: EvidenceState; anchorReason: string;
  anchorExtrapolated: boolean; wearCenter: null;
  rawAnchor: ImagePoint | null; filteredAnchor: ImagePoint | null; filterApplied: false;
  anchorEdges: [ImagePoint, ImagePoint] | null;
  traceInput: WristEngineObservation;
  axis2D: ImagePoint | null; axis3D: V3 | null; orientation: Quaternion | null;
  orientationState: EvidenceState; orientationSource: string; reason: string;
  axis2DSource: string; confidence2D: number; confidence3D: number; depthAgeMs: number | null;
  contourLine: [ImagePoint, ImagePoint] | null;
};
