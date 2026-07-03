"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// Camera choreography — a CONSTANT-RADIUS circular arc around the bath, always
// pointing at it:
//   hero  — FAR away (radius 30), a bit up (30° elevation), aimed at the bath
//   flow  — rides the arc up to the bath's ZENITH, same distance the whole way,
//           intercepting the column of spheres rising out of the basin
//   logo  — swings back down to a front-center framing as the mark assembles
const PIVOT = new THREE.Vector3(0, -1, -6); // bath center — the aim, always
const END_POS = new THREE.Vector3(0, 0, 13.5); // front-center for the logo reveal
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_ZENITH = new THREE.Vector3(0, 0, -1); // correct "up" when looking straight down

const RADIUS = 30;
const ORBIT_WINDOW = [0.15, 0.75] as const;

export function Rig() {
  // Scratch vectors — reused every frame, no per-frame allocation.
  const v = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      aim: new THREE.Vector3(),
      up: new THREE.Vector3(),
      orbitPos: new THREE.Vector3(),
      orbitAim: new THREE.Vector3(),
      orbitUp: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((state) => {
    const p = useProgressStore.getState().progress;
    const orbit = E.inOutSine(phaseLocal(p, ORBIT_WINDOW));
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const cam = state.camera;

    // Circle arc around the bath: elevation 30° → ~86° (zenith) at a CONSTANT
    // radius — the camera never moves closer, it only rides the arc.
    const phi = lerp(Math.PI / 6, 1.5, orbit);
    v.orbitPos
      .set(0, Math.sin(phi) * RADIUS, Math.cos(phi) * RADIUS)
      .add(PIVOT);

    // Blend the up vector near the top of the arc — lookAt with +Y up degenerates
    // when the view direction approaches straight down.
    const t = Math.min(1, Math.max(0, (orbit - 0.55) / 0.4));
    const upBlend = t * t * (3 - 2 * t);
    v.orbitUp.copy(UP_Y).lerp(UP_ZENITH, upBlend).normalize();

    // Always pointing at the bath — the aim never leaves it during the orbit.
    v.orbitAim.copy(PIVOT);

    // Assembly: swing down from the zenith to a front-center logo framing.
    v.pos.copy(v.orbitPos).lerp(END_POS, asm);
    v.up.copy(v.orbitUp).lerp(UP_Y, asm).normalize();
    v.aim.copy(v.orbitAim).lerp(ORIGIN, asm);

    cam.position.copy(v.pos);
    cam.up.copy(v.up);
    cam.lookAt(v.aim);
  });
  return null;
}
