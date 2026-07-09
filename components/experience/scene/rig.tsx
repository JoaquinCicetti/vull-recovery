"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, clamp01 } from "@/lib/experience/easing";
import {
  CAMERA_DUR,
  INTRO_AIM_Y,
  INTRO_FROM,
  SCROLL_CANCEL,
  introSeconds,
} from "@/lib/experience/intro";

// ONE continuous camera path (Catmull-Rom, arc-length sampled) instead of the
// old piecewise orbit — no velocity kinks between phases, so the ride feels like
// a single dolly move: hero framing → lift over the left shoulder → near-zenith
// above the bath (inside the rising column) → swing down front for the logo.
// On top of the spline, position/aim are exponentially damped so raw scroll
// steps never reach the camera — buttery even on notchy mouse wheels.
const PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 6, 50), // hero — far back so the bath reads small
    new THREE.Vector3(-8, 14, 34), // lift, drifting left (asymmetric, cinematic)
    new THREE.Vector3(-6, 27, 12), // climbing over the bath
    new THREE.Vector3(0, 33, -3), // near-zenith, inside the ball column
    new THREE.Vector3(5, 18, 6), // swing down, easing right
    new THREE.Vector3(0, 0, 13.5), // front-center for the logo reveal
  ],
  false,
  "centripetal",
);

// Aim choreography: at the hero the camera aims ABOVE the bath, dropping it
// into the BOTTOM HALF of the frame (clear of the hero text); the aim then
// eases down onto the bath as the ride starts, and to the logo plane at the end.
const AIM_HERO = new THREE.Vector3(0, 4.5, -6); // bath a touch below center, not sunk
const AIM_BATH = new THREE.Vector3(0, -2, -6); // near the bath center
const AIM_WINDOW = [0.08, 0.4] as const;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const INTRO_AIM = new THREE.Vector3(0, INTRO_AIM_Y, -6); // eases down onto AIM_HERO
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_ZENITH = new THREE.Vector3(0, 0, -1); // stable "up" when looking straight down

export function Rig() {
  // Damped state + scratch vectors — reused every frame, no allocation.
  const v = useMemo(
    () => ({
      // Starts at the ENTRY point, not the path head. While the veil is up the
      // camera waits out here; if it started on the path, the intro target would
      // pull it backwards and the entrance would play in reverse.
      pos: INTRO_FROM.clone(),
      aim: INTRO_AIM.clone(),
      pathPos: new THREE.Vector3(),
      targetPos: new THREE.Vector3(),
      targetAim: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame((state, dt) => {
    const { progress: p, introAt } = useProgressStore.getState();
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const aimDrop = E.inOutSine(phaseLocal(p, AIM_WINDOW));
    const cam = state.camera;

    // Entry weight: 0 behind the veil (introSeconds returns 0 while introAt is
    // null), easing to 1 over CAMERA_DUR. Any real scroll forces it to 1 — the user
    // asked to move, so the spline takes the camera and the entrance is abandoned.
    const w = Math.max(
      E.expoOut(clamp01(introSeconds(introAt) / CAMERA_DUR)),
      clamp01(p / SCROLL_CANCEL),
    );

    // Arc-length sampling → constant travel speed along the whole path.
    PATH.getPointAt(clamp01(p), v.pathPos);
    // Aim: above the bath (hero, bath in the bottom half) → onto the bath as the
    // ride starts → the logo plane at the end.
    v.targetAim.copy(AIM_HERO).lerp(AIM_BATH, aimDrop).lerp(ORIGIN, asm);

    // Blend the entrance in front of all of it. At w = 1 both lines are identities,
    // so the scroll ride is bit-for-bit what it was before the intro existed.
    v.targetPos.lerpVectors(INTRO_FROM, v.pathPos, w);
    v.targetAim.lerpVectors(INTRO_AIM, v.targetAim, w);

    // Frame-rate-independent exponential damping (the smoothness).
    const k = 1 - Math.exp(-4.5 * Math.min(dt, 0.05));
    v.pos.lerp(v.targetPos, k);
    v.aim.lerp(v.targetAim, k);

    // Up vector from view verticality: blends to (0,0,-1) as the view approaches
    // straight down, so lookAt never degenerates near the zenith.
    v.dir.copy(v.aim).sub(v.pos).normalize();
    const vert = Math.min(1, Math.max(0, (Math.abs(v.dir.y) - 0.78) / 0.18));
    const s = vert * vert * (3 - 2 * vert);
    v.up.copy(UP_Y).lerp(UP_ZENITH, s).normalize();

    cam.position.copy(v.pos);
    cam.up.copy(v.up);
    cam.lookAt(v.aim);
  });
  return null;
}
