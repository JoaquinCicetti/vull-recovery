"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveEvents } from "@react-three/drei";
import * as THREE from "three";
import { Spheres } from "./scene/spheres";
import { Lighting } from "./scene/lighting";
import { Rig } from "./scene/rig";
import { Effects } from "./scene/effects";
import { Bath } from "./scene/bath";
import { Atmosphere } from "./scene/atmosphere";

// WebGL layer: spheres rise from the bottom, then morph into the logo silhouette.
// Transparent background so it composites over the static hero. ssr:false.
// `active` pauses the render loop (frameloop "never") when the hero scrolls
// offscreen or the tab is hidden — the scene stops burning the GPU while the user
// reads the plans below. Full DPR is kept while in view (crisp); anti-aliasing is
// the EffectComposer's multisampling (canvas antialias off would be redundant).
export default function Scene({ active = true }: { active?: boolean }) {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  const count = isMobile ? 440 : 1000;

  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, isMobile ? 1.5 : 2]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        // Slight underexposure: the cinematic grade lives in the darks.
        toneMappingExposure: 0.9,
      }}
      // Long lens (~85mm equiv): compressed perspective, shallow-focus read.
      camera={{ fov: 24, near: 0.1, far: 100, position: [0, 0, 18] }}
    >
      {/* Pure-black falloff: objects separate via rim light, never a gradient. */}
      <fog attach="fog" args={["#010102", 14, 52]} />
      <Lighting />
      <Suspense fallback={null}>
        <Bath />
      </Suspense>
      <Atmosphere />
      <Spheres count={count} />
      <Rig />
      <Effects dof={!isMobile} />
      {/* Throttle raycasting/events while scrolling; DPR stays full for crispness. */}
      <AdaptiveEvents />
    </Canvas>
  );
}
