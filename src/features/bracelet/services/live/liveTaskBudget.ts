
/** Điều phối segmentation bổ sung, không phải quy tắc fit/confidence. Biên chưa chắc giữ nhịp 450ms; biên RGB tốt dùng ngân sách khoảng 10% thời gian theo chi phí đo được, tối đa hai giây giữa các lần kiểm tra. */
export function liveSkinInterval(costMs: number | null, reliableEdges: boolean) {
  if (!reliableEdges || costMs === null || !Number.isFinite(costMs) || costMs <= 0) return 450;
  return Math.max(450, Math.min(2000, costMs / .1));
}
