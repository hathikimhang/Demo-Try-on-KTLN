
/** Cùng phép phân loại chromaticity/luminance 4D của mask Upload. Live bỏ cấp phát mảng distance mỗi cặp pixel/nền, dừng khi đã khớp nền và chỉ gộp prototype bằng nhau chính xác; không đổi threshold, resolution, biên hay segmentation. */
export function liveForeground(backgrounds: number[][], threshold: number) {
  const unique = backgrounds.filter((b, i) => !backgrounds.slice(0, i).some(a => a.length === b.length && a.every((v, k) => v === b[k])));
  return (pixel: number[] | null): number => {
    if (!pixel || !(Infinity > threshold)) return 0;
    for (const b of unique) {
      if (!(Math.hypot(pixel[0] - b[0], pixel[1] - b[1], pixel[2] - b[2], pixel[3] - b[3]) > threshold)) return 0;
    }
    return 255;
  };
}
