"use client";

/* eslint-disable react-hooks/immutability --
   Procedural WebGL: useFrame advances the shader uTime uniforms every frame by
   design; the React Compiler immutability rule doesn't model this pattern. */

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { NOISE_GLSL, makeMat } from "./volumetric";

// Cheap fake volumetrics (no ray-marching): additive noise cards hugging the
// floor for the low drifting mist, plus two faint gradient quads aligned with the
// rim lights for the light-beam read. Everything is additive over pure black, so
// it can only ever ADD the rim tint — the room itself stays black.
// The shared noise/vertex shader and the material factory live in ./volumetric,
// alongside <Steam/> which uses the same language.

// Ground mist: 2-octave noise, fading upward (uv.y) and at the card's ends.
const MIST_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uSpeed;
  uniform vec3 uColor;
  ${NOISE_GLSL}
  void main() {
    vec2 p = vUv * vec2(4.0, 1.4);
    p.x += uTime * uSpeed;
    float n = noise(p) * 0.65 + noise(p * 2.3 + 7.0) * 0.35;
    float heightFade = pow(1.0 - vUv.y, 2.2);
    float edgeFade = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
    float a = n * heightFade * edgeFade * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// Floor light pool: soft radial gradient hugging the floor under the product —
// grounds the bath (contact light instead of a void beneath it).
const POOL_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  uniform vec3 uColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 1.9) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// Contact shadow: NORMAL-blended dark ellipse tight under the bath's footprint.
// Darkening against the lit pool/stage ellipse is the strongest "it stands on
// the floor" cue there is.
const SHADOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.25, d) * uOpacity;
    gl_FragColor = vec4(vec3(0.0), a);
  }
`;

// Light beam: brightest at the source (uv.y = 0), fading along its length and
// toward its sides, with a whisper of noise so it feels like lit haze.
const BEAM_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uColor;
  ${NOISE_GLSL}
  void main() {
    float along = pow(1.0 - vUv.y, 1.7);
    float across = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float haze = 0.75 + 0.25 * noise(vUv * vec2(3.0, 6.0) + vec2(0.0, uTime * 0.05));
    float a = along * across * haze * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

// Orient a plane's +Y (its uv.y axis) from the rim light along its aim direction.
function beamTransform(from: THREE.Vector3, to: THREE.Vector3) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.clone().normalize(),
  );
  const position = from.clone().add(dir.multiplyScalar(0.5));
  return { position, quaternion, len };
}

export function Atmosphere() {
  const { mists, beamMat, poolMat, shadowMat, beamL, beamR } = useMemo(() => {
    // Slightly more present than before — the haze is what gives light its
    // visible depth. Green tint lives HERE (scattered light), not on the scene.
    const mists = [
      makeMat(MIST_FRAG, "#a9c9b2", 0.085, 0.012),
      makeMat(MIST_FRAG, "#9dbfa8", 0.065, -0.02),
      makeMat(MIST_FRAG, "#93b49e", 0.05, 0.016),
    ];
    const beamMat = makeMat(BEAM_FRAG, "#b7d3c0", 0.05);
    // The pool is what makes the floor READ as floor around the product; without
    // enough of it the tub's base ends in black and looks like it is floating.
    const poolMat = makeMat(POOL_FRAG, "#a8bfae", 0.21);
    // Was 0.55 over an 11×7 ellipse — wider than the 9×5.3 tub, so it painted a
    // black halo AROUND the base and erased the very ground it was meant to imply.
    const shadowMat = makeMat(SHADOW_FRAG, "#000000", 0.34, 0, THREE.NormalBlending);
    // Shafts follow the LOWER lights (lighting.tsx): the main one rides the
    // lower-left key toward the bath; a fainter one rises from the under-glow.
    const beamL = beamTransform(
      new THREE.Vector3(-14, -4.6, 6),
      new THREE.Vector3(0, -2, -6),
    );
    const beamR = beamTransform(
      new THREE.Vector3(6, -4.9, -10),
      new THREE.Vector3(-1, -1.5, -6),
    );
    return { mists, beamMat, poolMat, shadowMat, beamL, beamR };
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const m of mists) m.uniforms.uTime.value = t;
    beamMat.uniforms.uTime.value = t;
  });

  return (
    <>
      {/* Low drifting mist, staggered in depth; fades upward, catches the rim tint. */}
      <mesh position={[0, -2.2, -13]} material={mists[0]}>
        <planeGeometry args={[46, 5.6]} />
      </mesh>
      <mesh position={[-3, -2.7, -7]} material={mists[1]}>
        <planeGeometry args={[38, 4.6]} />
      </mesh>
      <mesh position={[4, -3.2, -2]} material={mists[2]}>
        <planeGeometry args={[30, 3.6]} />
      </mesh>

      {/* Contact light pool + contact shadow under the bath — light around it,
          dark right beneath it: the pair that makes it STAND on the floor.
          renderOrder forces the shadow to composite over the pool. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -4.96, -6]}
        material={poolMat}
        renderOrder={1}
      >
        {/* Widened from 24² so ONE pool covers the whole room — the foreground
            crate at z −2 through the shelf at z −17. The old radius reached zero
            by z ≈ 0, leaving the floor in front of the tub black while the lit
            band sat behind it; the eye read that band as the ground and the tub's
            base, below it, as floating. */}
        <planeGeometry args={[44, 44]} />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -4.94, -6]}
        material={shadowMat}
        renderOrder={2}
      >
        {/* Hugs the tub's contact patch rather than exceeding it — the footprint
            is ~9 x 5.3 at the rim but the base tapers well inside that. */}
        <planeGeometry args={[8, 4.8]} />
      </mesh>

      {/* Faint beams rising from the rim lights through the haze. */}
      <mesh position={beamL.position} quaternion={beamL.quaternion} material={beamMat}>
        <planeGeometry args={[5, beamL.len]} />
      </mesh>
      <mesh position={beamR.position} quaternion={beamR.quaternion} material={beamMat}>
        <planeGeometry args={[5, beamR.len]} />
      </mesh>
    </>
  );
}
