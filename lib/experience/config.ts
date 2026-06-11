// Master timeline for the scroll experience. One pinned stage drives a single
// `progress` 0→1; each phase reads its own local 0→1 from a sub-range. Ranges
// overlap on purpose so transitions cross-dissolve. See docs/experience-architecture.md.

export const STAGE_VH = 650; // scroll length of the pinned stage

// Balls-only timeline over a static hero:
//   rise     — spheres rise from the bottom across the full width (few → many)
//   assembly — they reorganize into the logo silhouette
//   reveal   — resolve to the crisp flat SVG logo (3D fades out)
export const PHASES = {
  rise: [0.04, 0.55],
  assembly: [0.5, 0.84],
  reveal: [0.82, 1.0],
} as const;

export type PhaseRange = readonly [number, number];

/** Map global progress to a phase's local 0→1 (clamped). */
export function phaseLocal(p: number, [a, b]: PhaseRange): number {
  if (b === a) return 0;
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

/** Symmetric fade helper: 0 at the edges of a phase, 1 in the middle. */
export function phaseFade(localProgress: number, edge = 0.25): number {
  const lp = localProgress;
  if (lp <= 0 || lp >= 1) return 0;
  return Math.min(1, Math.min(lp, 1 - lp) / edge);
}
