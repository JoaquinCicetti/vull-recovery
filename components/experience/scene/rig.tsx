"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E } from "@/lib/experience/easing";

// ONE continuous camera path (Catmull-Rom, arc-length sampled) instead of the
// old piecewise orbit — no velocity kinks between phases, so the ride feels like
// a single dolly move: hero framing → lift over the left shoulder → near-zenith
// above the bath (inside the rising column) → swing down front for the logo.
// On top of the spline, position/aim are exponentially damped so raw scroll
// steps never reach the camera — buttery even on notchy mouse wheels.
const PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 4, 37.5), // hero — the user-approved framing (r 43.8, 6.5°)
    new THREE.Vector3(-7, 13, 27), // lift, drifting left (asymmetric, cinematic)
    new THREE.Vector3(-6, 26, 10), // climbing over the bath
    new THREE.Vector3(0, 33, -3), // near-zenith, inside the ball column
    new THREE.Vector3(5, 18, 6), // swing down, easing right
    new THREE.Vector3(0, 0, 13.5), // front-center for the logo reveal
  ],
  false,
  "centripetal",
);

const AIM_BATH = new THREE.Vector3(0, -1.5, -6); // slightly above the bath center
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_ZENITH = new THREE.Vector3(0, 0, -1); // stable "up" when looking straight down

export function Rig() {
  // Damped state + scratch vectors — reused every frame, no allocation.
  const v = useMemo(
    () => ({
      pos: PATH.getPointAt(0).clone(),
      aim: AIM_BATH.clone(),
      targetPos: new THREE.Vector3(),
      targetAim: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    }),
    [],
  );

  useFrame((state, dt) => {
    const p = useProgressStore.getState().progress;
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const cam = state.camera;

    // Arc-length sampling → constant travel speed along the whole path.
    PATH.getPointAt(Math.min(1, Math.max(0, p)), v.targetPos);
    // Aim rides the bath the whole way, easing to the logo plane at the end.
    v.targetAim.copy(AIM_BATH).lerp(ORIGIN, asm);

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
