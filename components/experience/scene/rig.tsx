"use client";

import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// Calm camera: frames the rising spheres a touch low, centers as they assemble into
// the logo, then a gentle push-in for the reveal. No orbiting — premium and still.
export function Rig() {
  useFrame((state) => {
    const p = useProgressStore.getState().progress;
    const rise = E.inOutSine(phaseLocal(p, PHASES.rise));
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const cam = state.camera;

    let z = lerp(13.5, 11.5, rise);
    z = lerp(z, 9.5, asm);

    // Don't aim at the bath's center — aim well ABOVE it at the start so the far bath
    // drops into the lower third of the frame (below the hero text). The aim eases to
    // dead-center (0) as the logo assembles, so the finished mark stays centered.
    const aimY = lerp(2.8, 0.0, asm);
    cam.position.set(0, aimY * 0.35, z);
    cam.lookAt(0, aimY, 0);
  });
  return null;
}
