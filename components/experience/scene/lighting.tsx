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

// Cinematic three-point setup around the bath (0,-3,-6) — deliberately
// ASYMMETRIC. The product stays mostly dark, but every curve reads: gradients
// reveal it, never brute-force illumination.
function KeyAndRim() {
  const lights = useMemo(() => {
    // KEY — strong but SOFT (large source): diagonal from the LOWER LEFT, in
    // front of the product. Neutral white; the softness comes from the 16x9 area.
    const key = new THREE.RectAreaLight("#edf1ec", 5.5, 16, 9);
    key.position.set(-16, -3, 10);
    key.lookAt(0, -2.5, -6);
    // RIM — subtle and COOL, from the UPPER RIGHT behind the product: separates
    // the dark side from the background without symmetry with the key.
    const rim = new THREE.RectAreaLight("#c9d9e4", 2.6, 10, 6);
    rim.position.set(12, 9, -18);
    rim.lookAt(-1, -2.5, -5);
    return [key, rim];
  }, []);
  return (
    <>
      <primitive object={lights[0]} />
      <primitive object={lights[1]} />
    </>
  );
}

// The only extra front light: nearly off through the act, ramping up during
// assembly so the VULL mark resolves out of the dark — luxury reveal.
function RevealKey() {
  const ref = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const p = useProgressStore.getState().progress;
    const asm = E.quintOut(phaseLocal(p, PHASES.assembly));
    if (ref.current) ref.current.intensity = 0.08 + asm * 1.1;
  });
  return (
    <directionalLight
      ref={ref}
      position={[0, 2, 24]}
      intensity={0.08}
      color="#f2fff5"
    />
  );
}

export function Lighting() {
  return (
    <>
      {/* Overhead fill: just enough to reveal the silhouette. No hotspots. */}
      <ambientLight intensity={0.05} />
      <directionalLight position={[0, 12, 2]} intensity={0.08} color="#e8f2ec" />

      <KeyAndRim />
      <RevealKey />

      {/* Under-glow: a soft diffused source beneath the product with smooth
          physical falloff — replaces the old blown-out floor pool. */}
      <pointLight
        position={[0, -4.5, -6]}
        intensity={2.2}
        distance={14}
        decay={2}
        color="#dfe8e1"
      />

      {/* Very dim environment, asymmetric: one faint GREEN strip (the only green
          source — it lives in reflections/particles, not the whole scene) and a
          neutral counter-strip. */}
      <Environment resolution={64}>
        <Lightformer intensity={0.1} position={[0, 6, -10]} scale={[16, 9, 1]} color="#0b0e0c" />
        <Lightformer intensity={0.28} position={[-7, 0, 2]} scale={[3, 10, 1]} color="#3d5c45" />
        <Lightformer intensity={0.18} position={[7, 1, 3]} scale={[4, 8, 1]} color="#2b3330" />
      </Environment>

      {/* Floor: dark and DIFFUSE — high roughness so light pools softly instead
          of reading as a blown-out reflective surface. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#030405" roughness={0.75} metalness={0.05} />
      </mesh>
    </>
  );
}
