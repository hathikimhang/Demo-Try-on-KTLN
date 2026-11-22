
/** Tọa độ đo của cả X và Y đều theo bề rộng ảnh, độc lập kích thước CSS. */
export type ImagePoint = { x: number; y: number };

export type NativeRoi = { x: number; y: number; width: number; height: number; imageWidth: number; imageHeight: number; data: Uint8ClampedArray };

export type ImageMask = { width: number; height: number; data: Uint8Array; roi: { x: number; y: number; width: number; height: number } };

export type ImageMeasurementDebug = {
  imageWidth: number; imageHeight: number; roi: Omit<NativeRoi, 'data'>;
  axis: [ImagePoint, ImagePoint]; cuts: [ImagePoint, ImagePoint][];
  method: 'foreground-profile' | 'semantic-body' | 'manual-edges'; rejection: string | null;
  rejected: Record<string, number>; separation: number; angleCorrection: number;
  selected?: [ImagePoint, ImagePoint];
  maskAvailable?: boolean;
};


/** Xử lý object-fit: contain, letterbox ở giữa và canvas tự co vừa. Click trong vùng đệm trả về null, không bị ép vào mép ảnh. */
export function clientToImagePoint(rect: { left: number; top: number; width: number; height: number }, canvas: { width: number; height: number }, image: { width: number; height: number }, clientX: number, clientY: number): ImagePoint | null {
  if (Math.min(rect.width, rect.height, canvas.width, canvas.height, image.width, image.height) <= 0) return null;
  const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const width = canvas.width * fit, height = canvas.height * fit;
  const x = (clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (clientY - rect.top - (rect.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y: y * image.height / image.width } : null;
}
