"use client";

import * as THREE from "three";
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

// Premium grade: very subtle high-threshold bloom (only the rims flare), slight
// contrast lift, almost-imperceptible chromatic aberration, soft vignette, fine
// grain. DoF (desktop) = long-lens shallow focus on the product plane, foreground
// particles melting into bokeh. Tone mapping is ACES Filmic on the renderer, with
// exposure pulled down slightly (scene.tsx). Nothing that reads as gaming RGB.
// The composer tree is STATIC (chosen once from `dof`) — swapping passes at
// runtime remounts the composer and freezes the render loop mid-animation.
// AA is SMAA (post-space), NOT buffer multisampling: an MSAA framebuffer can't
// blit its depth into the depth texture DepthOfField needs — Mac GPUs throw
// GL_INVALID_OPERATION glBlitFramebuffer (depth/stencil format mismatch).

const CA_OFFSET = new THREE.Vector2(0.00035, 0.00035);

export function Effects({ dof = true }: { dof?: boolean }) {
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
      {/* Focus tracks a world point between the bath (0,-3,-6) and the logo plane
          (z 0) — the orbiting camera's distance to the subject varies too much for
          a fixed focusDistance. Only a few particles stay perfectly sharp. */}
      <DepthOfField target={[0, -1.8, -4.5]} focalLength={0.085} bokehScale={3.4} />
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
