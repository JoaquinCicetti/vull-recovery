"use client";

/* eslint-disable react-hooks/immutability --
   Procedural WebGL: useFrame advances the shader uTime uniforms every frame by
   design; the React Compiler immutability rule doesn't model this pattern. */

import { useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// Cheap fake volumetrics (no ray-marching): additive noise cards hugging the
// floor for the low drifting mist, plus two faint gradient quads aligned with the
// rim lights for the light-beam read. Everything is additive over pure black, so
// it can only ever ADD the rim tint — the room itself stays black.

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

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

function makeMat(frag: string, color: string, opacity: number, speed = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: opacity },
      uSpeed: { value: speed },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

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
  const { mists, beamMat, poolMat, beamL, beamR } = useMemo(() => {
    // Slightly more present than before — the haze is what gives light its
    // visible depth. Green tint lives HERE (scattered light), not on the scene.
    const mists = [
      makeMat(MIST_FRAG, "#a9c9b2", 0.085, 0.012),
      makeMat(MIST_FRAG, "#9dbfa8", 0.065, -0.02),
      makeMat(MIST_FRAG, "#93b49e", 0.05, 0.016),
    ];
    const beamMat = makeMat(BEAM_FRAG, "#b7d3c0", 0.05);
    const poolMat = makeMat(POOL_FRAG, "#a8bfae", 0.11);
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
    return { mists, beamMat, poolMat, beamL, beamR };
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

      {/* Contact light pool under the bath — grounds it on the floor. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -4.96, -6]} material={poolMat}>
        <planeGeometry args={[20, 20]} />
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
