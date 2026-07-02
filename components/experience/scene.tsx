"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, AdaptiveEvents, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import { Spheres } from "./scene/spheres";
import { Lighting } from "./scene/lighting";
import { Rig } from "./scene/rig";
import { Effects } from "./scene/effects";

// WebGL layer: spheres rise from the bottom, then morph into the logo silhouette.
// Transparent background so it composites over the static hero. ssr:false.
// `active` pauses the render loop (frameloop "never") when the hero scrolls
// offscreen or the tab is hidden, so the scene stops burning the GPU while the
// user reads the plans below. antialias is off because the EffectComposer owns
// anti-aliasing (multisampling) — a canvas MSAA backbuffer would be redundant.
export default function Scene({ active = true }: { active?: boolean }) {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  const count = isMobile ? 650 : 1600;
  // One-way step-down: on sustained FPS decline drop to a cheaper tier (no DoF,
  // no MSAA); AdaptiveDpr handles the DPR side. Sphere count stays fixed (changing
  // it would remount the InstancedMesh).
  const [lowTier, setLowTier] = useState(false);

  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={[1, isMobile ? 1.5 : 2]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      camera={{ fov: 32, near: 0.1, far: 100, position: [0, 0, 14] }}
    >
      <fog attach="fog" args={["#070908", 14, 40]} />
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setLowTier(true)}
        onFallback={() => setLowTier(true)}
      />
      <Lighting />
      <Spheres count={count} />
      <Rig />
      <Effects dof={!isMobile} lowTier={lowTier} />
      {/* Drop DPR/events while scrolling so the scrub stays smooth. */}
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
    </Canvas>
  );
}
