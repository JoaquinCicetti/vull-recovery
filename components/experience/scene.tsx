"use client";

import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, AdaptiveEvents } from "@react-three/drei";
import * as THREE from "three";
import { Spheres } from "./scene/spheres";
import { Lighting } from "./scene/lighting";
import { Rig } from "./scene/rig";
import { Effects } from "./scene/effects";

// WebGL layer: spheres rise from the bottom, then morph into the logo silhouette.
// Transparent background so it composites over the static hero. ssr:false.
export default function Scene() {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  const count = isMobile ? 650 : 1600;

  return (
    <Canvas
      dpr={[1, isMobile ? 1.5 : 2]}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      camera={{ fov: 32, near: 0.1, far: 100, position: [0, 0, 14] }}
    >
      <fog attach="fog" args={["#070908", 14, 40]} />
      <Lighting />
      <Spheres count={count} />
      <Rig />
      <Effects dof={!isMobile} />
      {/* Drop DPR/events while scrolling so the scrub stays smooth. */}
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
    </Canvas>
  );
}
