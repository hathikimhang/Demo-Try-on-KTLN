
// Một hợp đồng hình học chung cho model, công thức sizing và dữ liệu debug.
// Đây là đơn vị model, không phải mm; Auto Fit không đổi tỷ lệ thiết kế.
export const BANGLE = { majorRadius: 1.12, tubeRadius: 0.10, oval: 0.84 } as const;

export const BANGLE_CLEARANCE_SCALE = 1.10;

// Sản phẩm demo chưa có size vật lý theo mm. Sản phẩm fixed-size phải
// tắt thay đổi size tự động cho tới khi có hiệu chuẩn True-to-Size.
export const BRACELET_ASSET: { id: string; fitting: 'visual-auto' | 'fixed-size'; physicalInnerDiameterMm: number | null } = {
  id: 'lumiere-demo', fitting: 'visual-auto', physicalInnerDiameterMm: null,
};

export const FOREARM = { top: 1.085, bottom: 1.005, length: 4, offset: 1.25, oval: 0.72 } as const;

export const WRIST_MODEL_RADIUS = FOREARM.bottom + (FOREARM.top - FOREARM.bottom) * (0.5 - FOREARM.offset / FOREARM.length);

export const BANGLE_INNER_RADIUS = (BANGLE.majorRadius - BANGLE.tubeRadius) * BANGLE_CLEARANCE_SCALE;


export function manualFit(value: number) {
  // Không có giới hạn size trên/dưới bị ẩn; đầu vào lỗi không phải fit hợp lệ.
  return Number.isFinite(value) && value > 0 ? value : 1;
}

export function finalWorldScale(baseScale: number, multiplier: number) {
  return baseScale * manualFit(multiplier); // Chỉ thay vòng, không scale proxy cổ tay.
}


/** Chỉ dùng cho Visual Auto Fit ảnh: giải bất đẳng thức khoảng hở qua bề dày torus so với proxy thuôn, không phóng proxy. Sản phẩm có size vật lý cố định không dùng giới hạn va chạm minh họa này. */
export function imageRenderFit(multiplier: number, measured: boolean) {
  if (!measured || BRACELET_ASSET.fitting !== 'visual-auto') return manualFit(multiplier);
  const slope = Math.abs(FOREARM.top - FOREARM.bottom) / FOREARM.length;
  const axialHalfThickness = BANGLE.tubeRadius * BANGLE_CLEARANCE_SCALE;
  const minimum = (WRIST_MODEL_RADIUS + .01) / (BANGLE_INNER_RADIUS - slope * axialHalfThickness);
  return Math.max(manualFit(multiplier), minimum);
}
