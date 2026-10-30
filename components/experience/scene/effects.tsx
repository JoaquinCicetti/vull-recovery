"use client";

import * as THREE from "three";
import {
  EffectComposer,
  Bloom,
  Vignette,
  BrightnessContrast,
  ChromaticAberration,
  SMAA,
} from "@react-three/postprocessing";

// Premium grade: very subtle high-threshold bloom (only the rims flare), slight
// contrast lift, almost-imperceptible chromatic aberration, soft vignette. No
// grain: redrawn every frame, it read as shimmer. Tone mapping is ACES Filmic on
// the renderer. Nothing that reads as gaming RGB.
//
// No depth of field: the velocity-driven blur read as an action-cam effect, so
// the scene is sharp at every beat. The composer tree is STATIC — swapping
// passes at runtime remounts the composer and freezes the render loop.
// AA is SMAA (post-space), NOT buffer multisampling.

const CA_OFFSET = new THREE.Vector2(0.00035, 0.00035);

export function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Bloom intensity={0.35} luminanceThreshold={0.8} luminanceSmoothing={0.3} mipmapBlur />
      <ChromaticAberration offset={CA_OFFSET} />
      {/* Gentle grade: local contrast comes from the lighting, not the LUT — keep
          shadow detail, no crushed blacks. */}
      <BrightnessContrast brightness={-0.02} contrast={0.08} />
      <Vignette offset={0.32} darkness={0.55} />
      <SMAA />
    </EffectComposer>
  );
}
