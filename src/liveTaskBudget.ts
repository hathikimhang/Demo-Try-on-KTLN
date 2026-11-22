/** Optional segmentation scheduling, not a fit/confidence rule. Preserve the
 * original 450ms retry cadence while edges are uncertain. With verified RGB
 * edges, budget expensive semantic observations to ~10% of elapsed time,
 * capped at two seconds so they are still checked during a stable session. */
export function liveSkinInterval(costMs: number | null, reliableEdges: boolean) {
  if (!reliableEdges || costMs === null || !Number.isFinite(costMs) || costMs <= 0) return 450;
  return Math.max(450, Math.min(2000, costMs / .1));
}
