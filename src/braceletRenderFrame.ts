import type { WristPose } from './wristGeometry';

/** Explicit boundary between tracking, sizing and rendering. Observed image
 * edges cannot supply a quaternion, model, material, lighting or camera here. */
export type BraceletRenderFrame = {
  tracking: Readonly<Omit<WristPose, 'radius' | 'calibrationRadius' | 'distanceScale'>>;
  sizing: Readonly<{ wristRadius: number; manualFitMultiplier: number }>;
  color: string;
};

export function braceletRenderFrame(tracking: WristPose, wristRadius: number, manualFitMultiplier: number, color: string): BraceletRenderFrame {
  if (!(wristRadius > 0) || !Number.isFinite(wristRadius) || !(manualFitMultiplier > 0) || !Number.isFinite(manualFitMultiplier)) throw new Error('Invalid bracelet sizing');
  return { tracking, sizing: { wristRadius, manualFitMultiplier }, color };
}

/** Legacy model adapter. Always take the rigid transform from detection;
 * fitting changes radius only, assigned absolutely rather than accumulated. */
export function renderPose(frame: BraceletRenderFrame): WristPose {
  return { ...frame.tracking, radius: frame.sizing.wristRadius };
}
