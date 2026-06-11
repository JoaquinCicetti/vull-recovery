"use client";

import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  DepthOfField,
} from "@react-three/postprocessing";

// Postprocessing grade. Bloom catches the sphere/check speculars; vignette + grain
// for cinematic cohesion. DoF (desktop only) gives the logo reveal an Apple-commercial
// shallow focus. Two trees so the conditional child never breaks the composer.
export function Effects({ dof = true }: { dof?: boolean }) {
  if (!dof) {
    return (
      <EffectComposer multisampling={4}>
        <Bloom
          intensity={0.5}
          luminanceThreshold={0.75}
          luminanceSmoothing={0.2}
          mipmapBlur
        />
        <Vignette offset={0.28} darkness={0.72} />
        <Noise opacity={0.04} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={4}>
      <DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.4} />
      <Bloom
        intensity={0.5}
        luminanceThreshold={0.75}
        luminanceSmoothing={0.2}
        mipmapBlur
      />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise opacity={0.04} />
    </EffectComposer>
  );
}
