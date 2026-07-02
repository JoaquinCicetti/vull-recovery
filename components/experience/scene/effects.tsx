"use client";

import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  DepthOfField,
} from "@react-three/postprocessing";

// Postprocessing grade. Bloom catches the sphere/check speculars; vignette + grain
// for cinematic cohesion; DoF (desktop) gives the logo reveal a shallow-focus read.
// The composer tree is STATIC (chosen once from `dof`) — swapping passes at runtime
// remounts the composer and freezes the render loop mid-animation. multisampling:4
// keeps edges smooth (canvas antialias is off; the composer owns AA).
export function Effects({ dof = true }: { dof?: boolean }) {
  if (!dof) {
    return (
      <EffectComposer multisampling={4}>
        <Bloom intensity={0.7} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.28} darkness={0.72} />
        <Noise opacity={0.04} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.4} />
      <Bloom intensity={0.7} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise opacity={0.04} />
    </EffectComposer>
  );
}
