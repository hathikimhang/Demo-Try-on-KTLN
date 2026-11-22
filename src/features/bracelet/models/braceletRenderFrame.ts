import type { WristPose } from './wrist.types';
/** Ranh giới giữa tracking, sizing và rendering. Biên ảnh quan sát không được cung cấp quaternion, model, material, lighting hoặc camera. */
export type BraceletRenderFrame = {
  tracking: Readonly<Omit<WristPose, 'radius' | 'calibrationRadius' | 'distanceScale'>>;
  sizing: Readonly<{ wristRadius: number; manualFitMultiplier: number }>;
  color: string;
};


export function braceletRenderFrame(tracking: WristPose, wristRadius: number, manualFitMultiplier: number, color: string): BraceletRenderFrame {
  if (!(wristRadius > 0) || !Number.isFinite(wristRadius) || !(manualFitMultiplier > 0) || !Number.isFinite(manualFitMultiplier)) throw new Error('Invalid bracelet sizing');
  return { tracking, sizing: { wristRadius, manualFitMultiplier }, color };
}


/** Adapter model hiện có luôn lấy rigid transform từ nhận diện; fitting chỉ gán bán kính tuyệt đối, không nhân tích lũy qua các frame. */
export function renderPose(frame: BraceletRenderFrame): WristPose {
  return { ...frame.tracking, radius: frame.sizing.wristRadius };
}
