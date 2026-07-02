"use client";

import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// Camera as a traveler through the act: starts aimed above the far bath (bath low
// in frame, clear of the hero text), then during the flow it pushes INTO the stream
// (opposite to the spheres' travel) while drifting laterally across it — orthogonal
// travel, no orbiting. Settles dead-center for the logo reveal.
export function Rig() {
  useFrame((state) => {
    const p = useProgressStore.getState().progress;
    const rise = E.inOutSine(phaseLocal(p, PHASES.rise));
    const flow = E.inOutSine(phaseLocal(p, PHASES.flow));
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    const cam = state.camera;

    // Mostly-fixed long-lens camera (fov 24 ≈ 85mm; distances pulled back to
    // compensate). Slow approach, gentle push into the stream during the flow.
    let z = lerp(18.0, 16.2, rise) - flow * 1.2;
    z = lerp(z, 13.5, asm);

    // Restrained lateral drift across the stream: out and back, half the old sweep.
    const x = Math.sin(flow * Math.PI) * 0.8;

    // Aim: well ABOVE the bath at the start (bath in the lower third, below the
    // hero text) → down to the stream during the flow → center for the mark.
    const aimY = lerp(2.8, 0.0, flow);
    cam.position.set(x, aimY * 0.35, z);
    // Look slightly against the drift so the stream sweeps past with parallax.
    cam.lookAt(-x * 0.4, aimY, 0);
  });
  return null;
}
