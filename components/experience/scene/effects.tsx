"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  DepthOfField,
  BrightnessContrast,
  ChromaticAberration,
  SMAA,
} from "@react-three/postprocessing";
import { useProgressStore } from "../progress-store";

// Premium grade: very subtle high-threshold bloom (only the rims flare), slight
// contrast lift, almost-imperceptible chromatic aberration, soft vignette, fine
// grain. Tone mapping is ACES Filmic on the renderer. Nothing that reads as
// gaming RGB.
//
// The blur is a SPEED EFFECT, not a static DoF: bokehScale sits at 0 while the
// scene is at rest (perfectly sharp — no muddy/pixelated bokeh on the product)
// and ramps up with scroll velocity, easing back down when the ride stops.
//
// The composer tree is STATIC (chosen once from `dof`) — swapping passes at
// runtime remounts the composer and freezes the render loop mid-animation.
// AA is SMAA (post-space), NOT buffer multisampling: an MSAA framebuffer can't
// blit its depth into the depth texture DepthOfField needs — Mac GPUs throw
// GL_INVALID_OPERATION glBlitFramebuffer (depth/stencil format mismatch).

const CA_OFFSET = new THREE.Vector2(0.00035, 0.00035);

// Effect instance type via the component ("postprocessing" is only a transitive
// dependency, so its classes aren't importable directly).
type DofEffect = React.ComponentRef<typeof DepthOfField>;

export function Effects({ dof = true }: { dof?: boolean }) {
  const dofRef = useRef<DofEffect>(null);
  const vel = useRef({ last: 0, v: 0 });

  // Smoothed |dprogress/dt| → bokehScale. Runs unconditionally (hook rules);
  // no-ops when the DoF pass isn't mounted.
  useFrame((_, dt) => {
    const eff = dofRef.current;
    if (!eff) return;
    const p = useProgressStore.getState().progress;
    const s = vel.current;
    const inst = Math.abs(p - s.last) / Math.max(dt, 1e-4);
    s.last = p;
    // Ease the velocity so the blur breathes in/out instead of flickering.
    s.v += (inst - s.v) * Math.min(1, dt * 6);
    eff.bokehScale = Math.min(3.2, s.v * 11);
  });

  if (!dof) {
    return (
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.35} luminanceThreshold={0.8} luminanceSmoothing={0.3} mipmapBlur />
        <ChromaticAberration offset={CA_OFFSET} />
        <BrightnessContrast brightness={-0.02} contrast={0.08} />
        <Vignette offset={0.32} darkness={0.55} />
        <Noise opacity={0.025} />
        <SMAA />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={0}>
      {/* Focus tracks a world point near the bath; bokehScale starts at 0 and is
          driven per-frame from scroll velocity (speed effect). */}
      <DepthOfField ref={dofRef} target={[0, -2.8, -5.5]} focalLength={0.085} bokehScale={0} />
      <Bloom intensity={0.35} luminanceThreshold={0.8} luminanceSmoothing={0.3} mipmapBlur />
      <ChromaticAberration offset={CA_OFFSET} />
      {/* Gentle grade: local contrast comes from the lighting, not the LUT — keep
          shadow detail, no crushed blacks. */}
      <BrightnessContrast brightness={-0.02} contrast={0.08} />
      <Vignette offset={0.32} darkness={0.55} />
      <Noise opacity={0.025} />
      <SMAA />
    </EffectComposer>
  );
}
