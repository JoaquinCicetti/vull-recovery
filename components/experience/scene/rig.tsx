"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// Camera choreography, orbit-based and always looking at the bath:
//   hero  — far away, a bit up, pitched ~30° down toward the bath on the floor
//   flow  — climbs the orbit to the bath's ZENITH (overhead), intercepting the
//           column of spheres rising out of it
//   logo  — swings back down to a front-center framing as the mark assembles
const PIVOT = new THREE.Vector3(0, -1, -6); // bath center
const HERO_AIM = new THREE.Vector3(0, 4.5, -6); // aim above the bath at rest → bath sits low in frame
const END_POS = new THREE.Vector3(0, 0, 13.5); // front-center for the logo reveal
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_ZENITH = new THREE.Vector3(0, 0, -1); // correct "up" when looking straight down

const ORBIT_WINDOW = [0.15, 0.75] as const;
const AIM_WINDOW = [0.1, 0.5] as const;

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
    const aimDrop = E.inOutSine(phaseLocal(p, AIM_WINDOW));
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const cam = state.camera;

    // Orbit around the bath: elevation 30° → ~86° (zenith), radius closing in.
    const phi = lerp(Math.PI / 6, 1.5, orbit);
    const r = lerp(26, 11, orbit);
    v.orbitPos
      .set(0, Math.sin(phi) * r, Math.cos(phi) * r)
      .add(PIVOT);

    // Blend the up vector near the top of the arc — lookAt with +Y up degenerates
    // when the view direction approaches straight down.
    const t = Math.min(1, Math.max(0, (orbit - 0.55) / 0.4));
    const upBlend = t * t * (3 - 2 * t);
    v.orbitUp.copy(UP_Y).lerp(UP_ZENITH, upBlend).normalize();

    // Aim: above the bath while the hero text shows (bath low in frame), easing
    // onto the bath itself as the orbit starts — never stops looking at it.
    v.orbitAim.copy(HERO_AIM).lerp(PIVOT, aimDrop);

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
