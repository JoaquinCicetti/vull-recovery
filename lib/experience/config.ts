// Master timeline for the scroll experience. One pinned stage drives a single
// `progress` 0→1; each phase reads its own local 0→1 from a sub-range. Ranges
// overlap on purpose so transitions cross-dissolve. See docs/experience-architecture.md.

// Three discrete steps drive this (progress 0 → 0.5 → 1):
//   step 0 (p=0)   — hero
//   step 1 (p=0.5) — spheres risen across the width + "Tu cuerpo, suspendido"
//   step 2 (p=1)   — spheres assembled into the logo + "Todo encuentra su lugar"
export const PHASES = {
  rise: [0.08, 0.5],
  assembly: [0.5, 1.0],
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
