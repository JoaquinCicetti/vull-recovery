"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// Water in the bath: one flat stadium-shaped surface in the tub's LOCAL space
// (it is mounted inside the bath's scaled group). Measured from
// model-bath-2.glb: inner floor y ≈ 0, rim ≈ 0.135, inner walls at |x| ≈ 0.40
// and |z| ≈ 0.145. The shape runs slightly into the walls so no gap shows; the
// walls hide the overlap.
//
// UNLIT on purpose. A glossy MeshStandardMaterial here coincided twice with
// black squares flashing on scroll, so this touches none of the lighting path
// (no area lights, no env map, no derived normals): the "reflection" is a
// fresnel sheen plus ripple glints computed from the camera position. Fog is
// kept so it sits in the room like everything else.
const LEVEL = 0.1;
const HALF_LEN = 0.41;
const HALF_W = 0.16;

function stadium(): THREE.Shape {
  const r = HALF_W;
  const straight = HALF_LEN - r;
  const s = new THREE.Shape();
  s.moveTo(-straight, -r);
  s.lineTo(straight, -r);
  s.absarc(straight, 0, r, -Math.PI / 2, Math.PI / 2, false);
  s.lineTo(-straight, r);
  s.absarc(-straight, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
  return s;
}

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vSurf;
  varying vec3 vWorldPos;
  void main() {
    vSurf = position.xy;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  varying vec2 vSurf;
  varying vec3 vWorldPos;
  void main() {
    // Slow ripples keyed on the surface's own coordinates: the pattern stays
    // put while the camera moves.
    vec2 q = vSurf * 40.0;
    vec2 w = vec2(
      sin(q.x * 1.3 + uTime * 0.9) + 0.6 * sin(q.y * 2.1 - uTime * 0.7),
      sin(q.y * 1.7 + uTime * 0.8) + 0.6 * sin((q.x + q.y) * 1.1 + uTime * 0.5)
    );
    vec3 n = normalize(vec3(w.x * 0.035, 1.0, w.y * 0.035));
    vec3 v = normalize(cameraPosition - vWorldPos);
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    float glint = smoothstep(0.6, 2.4, w.x + w.y);
    vec3 col = vec3(0.004, 0.007, 0.007)
      + vec3(0.32, 0.38, 0.37) * (0.06 + 0.5 * fres + 0.07 * glint);
    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function Water() {
  const ref = useRef<THREE.Mesh>(null);
  const { geo, mat } = useMemo(() => {
    const geo = new THREE.ShapeGeometry(stadium(), 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      fog: true,
    });
    return { geo, mat };
  }, []);

  useFrame((state) => {
    const m = ref.current?.material as THREE.ShaderMaterial | undefined;
    if (m) m.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh
      ref={ref}
      geometry={geo}
      material={mat}
      position={[0, LEVEL, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
    />
  );
}
