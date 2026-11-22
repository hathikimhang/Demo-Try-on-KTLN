// A single geometry contract for the model, sizing formula and debug readout.
// These are model units, not mm. Their proportions are unchanged by auto fit.
export const BANGLE = { majorRadius: 1.12, tubeRadius: 0.10, oval: 0.84 } as const;
export const BANGLE_CLEARANCE_SCALE = 1.10;
// This demo asset has no physical mm size. A fixed-size catalogue asset must
// opt out of automatic resizing until calibrated True-to-Size is implemented.
export const BRACELET_ASSET: { id: string; fitting: 'visual-auto' | 'fixed-size'; physicalInnerDiameterMm: number | null } = {
  id: 'lumiere-demo', fitting: 'visual-auto', physicalInnerDiameterMm: null,
};
export const FOREARM = { top: 1.085, bottom: 1.005, length: 4, offset: 1.25, oval: 0.72 } as const;
export const WRIST_MODEL_RADIUS = FOREARM.bottom + (FOREARM.top - FOREARM.bottom) * (0.5 - FOREARM.offset / FOREARM.length);
export const BANGLE_INNER_RADIUS = (BANGLE.majorRadius - BANGLE.tubeRadius) * BANGLE_CLEARANCE_SCALE;

export function manualFit(value: number) {
  // No hidden upper/lower sizing clamp. Invalid input is not a valid fit.
  return Number.isFinite(value) && value > 0 ? value : 1;
}
export function finalWorldScale(baseScale: number, multiplier: number) {
  return baseScale * manualFit(multiplier); // bracelet only; never scales the wrist proxy
}

/** Image Visual Auto Fit only. Solve the radial clearance inequality across
 * the torus thickness against the tapered proxy; never enlarge the proxy.
 * A fixed physical-size asset must not use this visual collision limit. */
export function imageRenderFit(multiplier: number, measured: boolean) {
  if (!measured || BRACELET_ASSET.fitting !== 'visual-auto') return manualFit(multiplier);
  const slope = Math.abs(FOREARM.top - FOREARM.bottom) / FOREARM.length;
  const axialHalfThickness = BANGLE.tubeRadius * BANGLE_CLEARANCE_SCALE;
  const minimum = (WRIST_MODEL_RADIUS + .01) / (BANGLE_INNER_RADIUS - slope * axialHalfThickness);
  return Math.max(manualFit(multiplier), minimum);
}
