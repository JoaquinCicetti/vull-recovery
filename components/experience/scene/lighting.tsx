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

// Soft stage light from above the bath, aimed straight down: draws a clear
// light ellipse on the floor around the product — THE grounding cue (the bath
// visibly stands on a lit surface instead of floating in a void).
function StageSpot() {
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, -5, -6);
    return o;
  }, []);
  return (
    <>
      <primitive object={target} />
      <spotLight
        position={[0, 13, -6]}
        target={target}
        angle={0.55}
        penumbra={1}
        intensity={190}
        distance={60}
        decay={2}
        color="#e6efe8"
      />
    </>
  );
}

export function Lighting() {
  return (
    <>
      {/* Overhead fill: just enough to reveal the silhouette. No hotspots. */}
      <ambientLight intensity={0.05} />
      <directionalLight position={[0, 12, 2]} intensity={0.08} color="#e8f2ec" />

      <StageSpot />

      <KeyAndRim />
      <RevealKey />

      {/* Under-glow: a soft diffused source beneath the product with smooth
          physical falloff — lights the floor around it so the bath reads as
          GROUNDED, not suspended in a void. */}
      <pointLight
        position={[0, -4.4, -6]}
        intensity={3.6}
        distance={18}
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

      {/* Floor: visibly a surface — catches the stage spot, the key sheen and
          the under-glow, so the horizon and the stage ellipse both read. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#090c10" roughness={0.55} metalness={0.15} />
      </mesh>
    </>
  );
}
