// Master timeline for the scroll experience. One pinned stage drives a single
// `progress` 0→1; each phase reads its own local 0→1 from a sub-range. Ranges
// overlap on purpose so transitions cross-dissolve. See docs/experience-architecture.md.

// The act, driven by continuous scroll progress:
//   rise     — spheres leave the bath through a column and spread across the screen
//   flow     — an endless stream of spheres travels toward and past the camera
//              ("La fatiga se disuelve")
//   assembly — the stream resolves into the VULL mark ("Todo encuentra su lugar")
export const PHASES = {
  rise: [0.05, 0.42],
  flow: [0.35, 0.78],
  assembly: [0.78, 1.0],
} as const;

export type PhaseRange = readonly [number, number];

// The room going dark for the finale: props, their panel lights, steam and the
// room lights all follow ONE eased envelope, starting as the mark begins to
// assemble. It used to be a linear 0.86→0.96 dissolve with the panel lights
// left on — about one trackpad flick, so it read as a switch, not a dimmer.
export const ROOM_OFF: PhaseRange = [0.74, 0.98];

/** 1 while the room is up, easing to 0 across ROOM_OFF (smoothstep). */
export function roomLevel(p: number): number {
  const t = phaseLocal(p, ROOM_OFF);
  return 1 - t * t * (3 - 2 * t);
}

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
