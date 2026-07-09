"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E } from "@/lib/experience/easing";
import { LIGHTS, introSeconds, stage } from "@/lib/experience/intro";

// One-time three.js global LUT upload required before the first RectAreaLight
// material compiles. Module scope is safe: this file only loads in the browser
// (scene.tsx is dynamically imported with ssr:false).
RectAreaLightUniformsLib.init();

// Every light's full-power intensity. Each is multiplied by its own entry envelope
// (lib/experience/intro.ts) so the room switches on as the loading veil lifts,
// rather than being on from frame one. Behind the veil (introAt === null) the
// envelopes are 0 and the scene is dark — nobody sees it.
const BASE = {
  ambient: 0.05,
  fill: 0.08,
  spot: 190,
  underglow: 3.6,
  key: 5.5,
  rim: 2.6,
} as const;

/** Seconds into the entrance, read non-reactively (never drive useFrame off state). */
function introT(): number {
  return introSeconds(useProgressStore.getState().introAt);
}

// Cinematic three-point setup around the bath (0,-3,-6) — deliberately
// ASYMMETRIC. The product stays mostly dark, but every curve reads: gradients
// reveal it, never brute-force illumination.
function KeyAndRim() {
  const keyRef = useRef<THREE.RectAreaLight>(null);
  const rimRef = useRef<THREE.RectAreaLight>(null);

  // A RectAreaLight has no `target`; it must be aimed once, after it is positioned.
  useEffect(() => {
    keyRef.current?.lookAt(0, -2.5, -6);
    rimRef.current?.lookAt(-1, -2.5, -5);
  }, []);

  // Key rakes in, rim separates last.
  useFrame(() => {
    const t = introT();
    if (keyRef.current) {
      keyRef.current.intensity = BASE.key * E.expoOut(stage(t, LIGHTS.key));
    }
    if (rimRef.current) {
      rimRef.current.intensity = BASE.rim * E.expoOut(stage(t, LIGHTS.rim));
    }
  });

  return (
    <>
      {/* KEY — strong but SOFT (large source): diagonal from the LOWER LEFT, in
          front of the product. Neutral white; the softness comes from the 16x9 area. */}
      <rectAreaLight
        ref={keyRef}
        color="#edf1ec"
        intensity={0}
        width={16}
        height={9}
        position={[-16, -3, 10]}
      />
      {/* RIM — subtle and COOL, from the UPPER RIGHT behind the product: separates
          the dark side from the background without symmetry with the key. */}
      <rectAreaLight
        ref={rimRef}
        color="#c9d9e4"
        intensity={0}
        width={10}
        height={6}
        position={[12, 9, -18]}
      />
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
    // Scaled by the room's own bleed-in, so it cannot glow before the lights are up.
    const up = E.expoOut(stage(introT(), LIGHTS.fill));
    if (ref.current) ref.current.intensity = (0.08 + asm * 1.1) * up;
  });
  return (
    <directionalLight
      ref={ref}
      position={[0, 2, 24]}
      intensity={0}
      color="#f2fff5"
    />
  );
}

// Soft stage light from above the bath, aimed straight down: draws a clear
// light ellipse on the floor around the product — THE grounding cue (the bath
// visibly stands on a lit surface instead of floating in a void).
function StageSpot() {
  const ref = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(0, -5, -6);
    return o;
  }, []);

  // The strike. backOut overshoots to ~1.1 before settling — a lamp catching, not a
  // fader being pushed. It is the beat the rest of the entrance hangs off.
  useFrame(() => {
    if (ref.current) {
      ref.current.intensity = BASE.spot * E.backOut(stage(introT(), LIGHTS.spot));
    }
  });

  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={ref}
        position={[0, 13, -6]}
        target={target}
        angle={0.55}
        penumbra={1}
        intensity={0}
        distance={60}
        decay={2}
        color="#e6efe8"
      />
    </>
  );
}

export function Lighting() {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const underglowRef = useRef<THREE.PointLight>(null);

  // The room bleeding up: ambient, fill and under-glow rise together and first,
  // before the spot strikes over them.
  useFrame(() => {
    const t = introT();
    const bleed = E.expoOut(stage(t, LIGHTS.fill));
    const glow = E.expoOut(stage(t, LIGHTS.underglow));
    if (ambientRef.current) ambientRef.current.intensity = BASE.ambient * bleed;
    if (fillRef.current) fillRef.current.intensity = BASE.fill * bleed;
    if (underglowRef.current) {
      underglowRef.current.intensity = BASE.underglow * glow;
    }
  });

  return (
    <>
      {/* Overhead fill: just enough to reveal the silhouette. No hotspots. */}
      <ambientLight ref={ambientRef} intensity={0} />
      <directionalLight
        ref={fillRef}
        position={[0, 12, 2]}
        intensity={0}
        color="#e8f2ec"
      />

      <StageSpot />

      <KeyAndRim />
      <RevealKey />

      {/* Under-glow: a soft diffused source beneath the product with smooth
          physical falloff — lights the floor around it so the bath reads as
          GROUNDED, not suspended in a void. */}
      <pointLight
        ref={underglowRef}
        position={[0, -4.4, -6]}
        intensity={0}
        distance={18}
        decay={2}
        color="#dfe8e1"
      />

      {/* Very dim environment, asymmetric: one faint GREEN strip (the only green
          source — it lives in reflections/particles, not the whole scene) and a
          neutral counter-strip. */}
      <Environment resolution={64}>
        <Lightformer
          intensity={0.1}
          position={[0, 6, -10]}
          scale={[16, 9, 1]}
          color="#0b0e0c"
        />
        <Lightformer
          intensity={0.28}
          position={[-7, 0, 2]}
          scale={[3, 10, 1]}
          color="#3d5c45"
        />
        <Lightformer
          intensity={0.18}
          position={[7, 1, 3]}
          scale={[4, 8, 1]}
          color="#2b3330"
        />
      </Environment>

      {/* Floor: a plain dark surface. A MeshReflectorMaterial used to live here,
          but it re-rendered the whole scene into a second target every frame and
          blurred it — the single most expensive thing in the frame. The bath is
          welded to the floor by the light pool and contact shadow in
          <Atmosphere/>, which cost almost nothing. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial
          color="#090c10"
          roughness={0.55}
          metalness={0.15}
        />
      </mesh>
    </>
  );
}
