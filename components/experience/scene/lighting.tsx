"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E } from "@/lib/experience/easing";

// One-time three.js global LUT upload required before the first RectAreaLight
// material compiles. Module scope is safe: this file only loads in the browser
// (scene.tsx is dynamically imported with ssr:false).
RectAreaLightUniformsLib.init();

// Silhouette rig: two LARGE soft rectangular area lights sitting on the floor
// behind the product, one per side, tilted ~23° up toward the model's back. They
// never hit front faces — their only job is a crisp bright rim. Cool white with a
// subtle green tint; softness comes from size, not intensity.
function RimLights() {
  const lights = useMemo(() => {
    const make = (x: number, intensity: number, color: string) => {
      const l = new THREE.RectAreaLight(color, intensity, 12, 5);
      l.position.set(x, -4.9, -13); // on the floor, behind the product
      l.lookAt(-Math.sign(x) * 1.2, -0.4, -5); // ~23° up toward the model's back
      return l;
    };
    return [make(-8, 9, "#dff0e6"), make(8, 7, "#cfe6dd")];
  }, []);
  return (
    <>
      <primitive object={lights[0]} />
      <primitive object={lights[1]} />
    </>
  );
}

// The ONLY front light. Nearly off through the whole act (the scene lives on its
// rims), then ramps up during assembly so the VULL mark resolves white out of the
// dark — luxury reveal, not product catalog.
function RevealKey() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const p = useProgressStore.getState().progress;
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    if (ref.current) ref.current.intensity = 0.1 + asm * 1.15;
  });
  return (
    <directionalLight
      ref={ref}
      position={[0, 2, 24]}
      intensity={0.1}
      color="#f2fff5"
    />
  );
}

// Cinematic dark-room rig: no strong front light, silhouettes only. The scene
// should stay almost entirely black — separation comes from the rim lights and
// the atmosphere, never from brightness.
export function Lighting() {
  return (
    <>
      {/* Fill: extremely weak, from above. Barely reveals the shapes; no hotspots. */}
      <ambientLight intensity={0.05} />
      <directionalLight position={[0, 12, 2]} intensity={0.09} color="#e8f2ec" />

      <RimLights />
      <RevealKey />

      {/* Very dim environment: two faint side strips so sphere edges still catch a
          sliver of green-white between the area lights. No bright panels. */}
      <Environment resolution={64}>
        <Lightformer intensity={0.12} position={[0, 6, -10]} scale={[16, 9, 1]} color="#0c110e" />
        <Lightformer intensity={0.3} position={[-7, 0, 2]} scale={[3, 10, 1]} color="#3f6b47" />
        <Lightformer intensity={0.25} position={[7, 0, 2]} scale={[3, 10, 1]} color="#33523f" />
      </Environment>

      {/* Near-black floor, faintly reflective so the rim light pools on it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#020304" roughness={0.4} metalness={0.2} />
      </mesh>
    </>
  );
}
