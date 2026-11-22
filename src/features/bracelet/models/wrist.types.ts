import type { ImagePoint } from './imageCoordinates';

import type { Point } from '../../../shared/types/vision';
export type Section = { center: ImagePoint; left: ImagePoint; right: ImagePoint; width: number; along: number };

export type ForearmContour = {
  direction: ImagePoint | null; confidence: number; reason: string;
  source: 'contour-rgb' | 'contour-segmentation'; sections: Section[];
  line?: [ImagePoint, ImagePoint]; residualPx?: number; extentPx?: number;
};


export type ForearmSource = 'Pose' | 'contour-rgb' | 'contour-segmentation' | 'temporal-axis' | 'hand-assumption' | 'hand-calibrated' | 'None';

export type LiveOrientation = {
  pose: WristPose | null; source: ForearmSource; confidence: number;
  depth: 'Pose' | 'held-Pose' | 'assumed-straight'; reason: string;
  handAxis: V3; forearmAxis: V3 | null; palmNormal: V3; wristAnchor: V3;
  basisCondition?: number; transportedRoll?: boolean;
};

export type TrackingMode = 'forearm' | 'straight-wrist';


export type V3 = { x: number; y: number; z: number };

export type Quaternion = { x: number; y: number; z: number; w: number };

export type WristPose = {
  center: V3; orientation: Quaternion; radius: number; palmLength: number;
  // Bán kính là nửa bề rộng cổ tay ước lượng theo hệ ảnh, không phải mét.
  focal: number; aspect: number; handedness: string;
  source?: TrackingMode;
  // Span cổ tay → MCP giữa trước khi fit vòng mang thông tin khoảng cách
  // độc lập với prior bán kính/ellipse; giá trị này KHÔNG có đơn vị mét.
  distanceScale?: number;
  calibrationRadius?: number;
};


/** Trục camera: +X sang phải, +Y xuống, +Z ra xa; độ dài quy theo bề rộng ảnh. Chưa có hiệu chuẩn camera hay phép đo cẳng tay vật lý. */
export type WristOptions = { mode?: TrackingMode; armPoints?: Point[]; armWorldPoints?: Point[]; deferAxialCheck?: boolean };

export type WristReason = 'ok' | 'no-hand' | 'invalid-data' | 'cropped' | 'scale' | 'fit' | 'no-forearm' | 'arm-match' | 'arm-direction' | 'axial-view' | 'degenerate' | 'bounds';

export type WristMetrics = { fitResidual?: number; imageScale?: number; scaleSpread?: number; basisCondition?: number; viewAlignment?: number; armVisibility?: number };

export type WristAnalysis = { pose: WristPose | null; reason: WristReason; metrics: WristMetrics };


export type InputWristAnalysis = WristAnalysis & {
  requestedMode: TrackingMode; effectiveMode: TrackingMode; fallbackReason?: WristReason;
};
