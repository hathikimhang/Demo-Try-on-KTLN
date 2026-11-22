export type Mode = 'bracelet' | 'shirt';
export type TrackingMode = 'forearm' | 'straight-wrist';
export type Point = { x: number; y: number; z?: number; visibility?: number };
export type SkinSegmentation = { width: number; height: number; confidence: Float32Array };
export type WorkerReply = { type: 'ready' } | { type: 'error'; message: string } | {
  type: 'result'; points: Point[]; worldPoints: Point[]; handedness: string;
  armPoints: Point[]; armWorldPoints: Point[];
  elapsed: number; timestamp: number; trackingMode: TrackingMode; frame?: ImageBitmap;
  skin?: SkinSegmentation;
  armStatus?: string; pipelineVersion?: string;
  liveObservation?: import('./liveVision').LiveObservation;
  timings?: { handMs: number; armMs: number; skinMs: number; observationMs: number };
};
