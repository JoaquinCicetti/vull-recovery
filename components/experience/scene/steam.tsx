"use client";

/* eslint-disable react-hooks/immutability --
   Procedural WebGL: useFrame advances the shader uTime uniforms every frame by
   design; the React Compiler immutability rule doesn't model this pattern. */

import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { NOISE_GLSL, makeMat } from "./volumetric";

// Steam rising from the sauna door. Same fake-volumetric language as
// <Atmosphere/>: additive noise cards, no ray-marching.
//
// Rendered as CROSSED QUADS (two planes at 90°) rather than one plane — the
// camera climbs to a near-zenith (0, 33, −3) at mid-scroll, where a single
// vertical card would be edge-on and vanish.
//
// There is deliberately NO plume over the bath: that volume is where 780 sphere
// instances pool and rise (spheres.tsx:127-129), and translucent steam through
// the ball column would mud the scene's signature move and pile up overdraw
// exactly where instance density peaks.

// Noise scrolled UPWARD, narrow at the base and widening with height, with
// smoothstep fades on all three open edges so the card has no visible boundary.
const PLUME_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;
  uniform vec3 uColor;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vUv * vec2(2.2, 2.6);
    p.y -= uTime * uSpeed;          // rise
    p.x += sin(vUv.y * 2.4 + uTime * 0.08) * 0.18;  // lazy lateral drift
    float n = noise(p) * 0.62 + noise(p * 2.7 + 3.0) * 0.38;
    // The plume widens as it climbs: the usable half-width grows with uv.y.
    float halfW = mix(0.12, 0.5, pow(vUv.y, 0.7));
    float across = smoothstep(halfW, halfW * 0.35, abs(vUv.x - 0.5));
    float rise = smoothstep(0.0, 0.16, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float a = n * across * rise * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const BASE_OPACITY = 0.3;

export function Steam() {
  const { mat, plumes } = useMemo(() => {
    const mat = makeMat(PLUME_FRAG, "#dcc9ad", BASE_OPACITY, 0.05);
    // Two crossed quads at the sauna door (world −17, −30, yawed 0.35).
    const plumes: { pos: [number, number, number]; rotY: number }[] = [
      { pos: [-15.7, -2.1, -28.3], rotY: 0.35 },
      { pos: [-15.7, -2.1, -28.3], rotY: 0.35 + Math.PI / 2 },
    ];
    return { mat, plumes };
  }, []);

  useFrame((state) => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    // Dissolve with the props over the assembly window, for the same reason:
    // the plume de-fogs as the camera closes in, and the finale belongs to the mark.
    const p = useProgressStore.getState().progress;
    const k = 1 - Math.min(1, Math.max(0, (p - 0.86) / 0.1));
    mat.uniforms.uOpacity.value = BASE_OPACITY * k;
  });

  return (
    <>
      {plumes.map((pl, i) => (
        <mesh key={i} position={pl.pos} rotation={[0, pl.rotY, 0]} material={mat}>
          <planeGeometry args={[3.2, 6.4]} />
        </mesh>
      ))}
    </>
  );
}
