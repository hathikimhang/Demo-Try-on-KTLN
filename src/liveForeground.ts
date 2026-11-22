/** Identical 4D chromaticity/luminance predicate to the Upload mask path.
 * Live avoids allocating distance arrays for every pixel/background pair,
 * exits when ANY known background matches, and deduplicates only exact
 * prototypes. No threshold, resolution, edge or segmentation changes. */
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
