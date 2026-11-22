import type { WristEngineMode } from '../models/wristEngine.types';
import type { Point } from '../../../shared/types/vision';
import type { TrackingMode, WristPose, ForearmContour, LiveOrientation } from '../models/wrist.types';
import { WristFilter } from '../services/tracking/WristFilter';
import { BraceletRenderer } from '../views/rendering/braceletRenderer';
import { emptyTracking } from '../models/tracking.types';
import type { TrackingSnapshot, PixelFrame } from '../models/tracking.types';
import { WristSizer } from '../services/fitting/braceletSizing';
import type { FitMethod, SizingDebug, WidthMeasurement } from '../models/fitting.types';
import { WristRoiTracker } from '../services/tracking/wristRoiTracking';
import { WristDebugLog } from '../services/diagnostics/wristDiagnostics';
import type { ImageMask, ImagePoint } from '../models/imageCoordinates';
import { LiveWristSession } from '../services/live/liveWristTracking';
import { LiveForearmEstimator } from '../services/live/liveForearmPose';
import type { LivePresentation } from '../models/liveContinuity';
import { LiveFrameBuffer } from '../services/live/liveFrameBuffer';
import { LiveFrameClock, LiveFrameGate } from '../services/live/liveFrameClock';
import type { CameraFrame } from '../services/live/liveFrameClock';
import { LivePerformance } from '../services/diagnostics/livePerformance';
import type { BraceletDetection as Detection } from '../models/vision.types';
import type { InputWristAnalysis } from '../models/wrist.types';
export function createBraceletState() {
  return {
    pocFrameId: 0,
    wrist: null as WristPose | null,
    lastDetection: null as Detection | null,
    renderFailed: false,
    sizer: new WristSizer(),
    roi: new WristRoiTracker(),
    live: new LiveWristSession(),
    lastSkinRequest: -Infinity,
    measurementCanvas: null as HTMLCanvasElement | null,
    forearm: new LiveForearmEstimator(),
    liveOrientation: null as LiveOrientation | null,
    forearmContour: null as ForearmContour | null,
    liveMask: null as ImageMask | null,
    needsArmObservation: false,
    frameClock: new LiveFrameClock(),
    frameGate: new LiveFrameGate(),
    performance: new LivePerformance(),
    latestCameraFrame: null as CameraFrame | null,
    lastCapturedVideoFrame: -1,
    skinCostMs: null as number | null,
    uiNextAt: 0,
    uiSemantic: '',
    liveHint: '',
    workerLatency: 0,
    liveSizingDebug: null as SizingDebug | null,
    logCount: 0,
    painted: null as unknown[] | null,
    presentedTimestamp: 0,
    sensorCaptureTime: undefined as number | undefined,
    requestSensorCaptureTime: undefined as number | undefined,
    frameSensorCaptureTime: undefined as number | undefined,
    frameBuffer: new LiveFrameBuffer(),
    presentation: 'hidden' as LivePresentation,
    holdUntil: 0,
    lastResultTimestamp: 0,
    sizing: null as { method: FitMethod; message: string; measurement: WidthMeasurement; reference: WristPose } | null,
    sizingKey: null as { pose: WristPose; fit: number; width: number } | null,
    imageMask: null as ImageMask | null,
    imagePose: null as WristPose | null,
    trackingPose: null as WristPose | null,
    renderPose: null as WristPose | null,
    manualEdges: null as [ImagePoint, ImagePoint] | null,
    pickingEdges: false,
    picked: [] as ImagePoint[],
    filter: new WristFilter(),
    bracelet: new BraceletRenderer(),
    tracking: emptyTracking()
  };
}
export type BraceletSession = ReturnType<typeof createBraceletState> & { source: string; image: HTMLImageElement | null; frame: ImageBitmap | null; points: Point[]; receivedAt: number; capturedAt: number; generation: number; pending: boolean; raf: number };
export type BraceletAppearance = { color: string; scale: number; showPoints: boolean; trackingMode: TrackingMode; debug: boolean; engineDebugMode?: WristEngineMode; autoFit: boolean };
export type BraceletBindings = {
  state: { current: BraceletSession }; appearance: { current: BraceletAppearance }; debugLog: { current: WristDebugLog };
  canvas: { current: HTMLCanvasElement | null }; video: { current: HTMLVideoElement | null };
  setTracking: (value: TrackingSnapshot) => void; setSizing: (value: SizingDebug | null) => void; setDetected: (value: boolean) => void; setTrackingHint: (value: string) => void; setDebugCount: (value: number) => void; setError: (value: string) => void;
  setCalibration: (value: { picking: boolean; count: number; message: string }) => void;
  paint: () => void; updateWrist: (data: Detection) => void; publishLive: () => void; submit: (image: HTMLVideoElement | HTMLImageElement, video: boolean, generation: number) => Promise<void>;
};
export type WristPreparation = { aspect: number; modeOption: TrackingMode; analysis: InputWristAnalysis; stale: boolean; mismatch: boolean; pixels: PixelFrame | null };
