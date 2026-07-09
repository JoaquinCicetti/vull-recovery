import * as THREE from "three";
import { clamp01 } from "./easing";

// The ENTRY animation — a one-shot, time-driven timeline that runs the moment the
// loading veil lifts, independent of the scroll `progress` in config.ts. The room
// switches on (staggered lights) while the camera pushes in from further back and
// settles exactly onto the hero point the scroll spline starts from, so there is no
// seam when the ride takes over.

/** Where the camera waits behind the veil, and pushes in from. */
export const INTRO_FROM = new THREE.Vector3(0, 9, 72);
/** Aim height at the start; eases down to the Rig's AIM_HERO (y = 4.5). */
export const INTRO_AIM_Y = 5.2;
/** Seconds for the camera to reach the hero framing. */
export const CAMERA_DUR = 2.4;
/** Past this much scroll the entrance is over — the user asked to move. */
export const SCROLL_CANCEL = 0.03;

export type Stage = readonly [delay: number, duration: number];

// [delay, duration] in seconds. Read as a lighting board being walked up: the room
// bleeds in, the overhead spot strikes, the key rakes across, the rim separates last.
export const LIGHTS = {
  underglow: [0.0, 0.9],
  fill: [0.0, 0.9],
  spot: [0.3, 0.7],
  key: [0.65, 0.8],
  rim: [1.0, 0.7],
} as const satisfies Record<string, Stage>;

/** Seconds since the veil lifted. 0 while still loading (nothing has started). */
export function introSeconds(introAt: number | null): number {
  return introAt === null ? 0 : (performance.now() - introAt) / 1000;
}

/** A stage's local 0→1 within the intro clock. */
export function stage(t: number, [delay, duration]: Stage): number {
  return clamp01((t - delay) / duration);
}
