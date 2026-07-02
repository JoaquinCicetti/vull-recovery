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

    // Pan the whole view up ~10% of frame height at the start so the far bath reads
    // at the middle-bottom of the screen (not dead-center). Eases to 0 as the logo
    // assembles, so the finished mark stays centered.
    const up = (1.0 - asm) * 0.9;
    const lookY = lerp(-1.2, 0.0, asm); // start low (balls from bottom) → center
    cam.position.set(0, lookY * 0.45 + up, z);
    cam.lookAt(0, lookY + up, 0);
  });
  return null;
}
