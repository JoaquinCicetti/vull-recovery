"use client";

/* eslint-disable react-hooks/immutability --
   Procedural WebGL: useFrame writes a shader uniform every frame by design; the
   React Compiler immutability rule doesn't model this pattern. */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { roomLevel } from "@/lib/experience/config";
import { E } from "@/lib/experience/easing";
import { LIGHTS, introSeconds, stage } from "@/lib/experience/intro";
import { VERT_WORLD_XZ } from "./volumetric";

// The floor: dark slate 1 m tiles that melt into the black.
//
// UNLIT ON PURPOSE. It fills half the frame, and as a standard material every one
// of those pixels paid for four rect-area lights, the spot and the environment. It
// was the most expensive surface in the scene and caused hitches at the end of the
// scroll. Its light is painted instead, as soft pools where the real lights land.
// That also makes it view-independent, so it cannot wash out to grey under the spot
// when the camera passes overhead.
//
// The scene renders straight to an 8-bit canvas with no post stack, which sets
// the other rules here:
//
// * DITHER. Dark gradients only get a few 8-bit levels and show as stripes. The
//   noise is static per pixel, so it cannot shimmer the way grain did.
// * NOISE COMES FROM A MIPMAPPED TEXTURE, not hashed in the fragment shader. At
//   this grazing angle unfiltered noise crawls as the camera moves. It is keyed on
//   world position, never on anything view-space.
// * JOINTS ARE ANALYTIC, not texture. They are filtered against the pixel's own
//   footprint and fade to their average coverage in the distance, so thin lines
//   neither break up nor crawl along the long lens's grazing view.

const NOISE_SIZE = 256;

/** Deterministic, tileable fBm in a mipmapped single-channel texture. */
function makeNoiseTexture(): THREE.DataTexture {
  let seed = 0x5eed1234;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const values = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  let weight = 1;
  for (const period of [6, 12, 24, 48, 96]) {
    const lattice = Float32Array.from({ length: period * period }, random);
    const step = period / NOISE_SIZE;
    for (let y = 0; y < NOISE_SIZE; y++) {
      const gy = y * step;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      const v = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < NOISE_SIZE; x++) {
        const gx = x * step;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const u = fx * fx * (3 - 2 * fx);
        const x1 = (x0 + 1) % period;
        const row0 = y0 * period;
        const row1 = ((y0 + 1) % period) * period;
        const top = lattice[row0 + x0] * (1 - u) + lattice[row0 + x1] * u;
        const bottom = lattice[row1 + x0] * (1 - u) + lattice[row1 + x1] * u;
        values[y * NOISE_SIZE + x] += (top * (1 - v) + bottom * v) * weight;
      }
    }
    weight *= 0.55;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const bytes = Uint8Array.from(values, (value) =>
    Math.round(((value - min) / (max - min)) * 255),
  );

  const texture = new THREE.DataTexture(bytes, NOISE_SIZE, NOISE_SIZE, THREE.RedFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const FLOOR_FRAG = /* glsl */ `
  varying vec2 vWorldXZ;
  uniform sampler2D uFloorNoise;
  uniform vec3 uTint;
  uniform float uLevel;

  const vec2 BATH_XZ = vec2(0.0, -6.0);
  // 1 m tiles at 5.29 units per metre, with the bath centred on one tile.
  const float TILE = 5.29;
  const float JOINT = 0.05; // grout width in world units (~1 cm)

  float pool(vec2 center, float radius, float falloff) {
    return pow(max(0.0, 1.0 - length(vWorldXZ - center) / radius), falloff);
  }

  // Grout coverage, 0 on the tile and 1 on the joint. Filtered per axis against
  // the pixel footprint (after Ben Golus's "pristine grid").
  float joints(vec2 uv) {
    vec2 deriv = fwidth(uv);
    vec2 target = vec2(2.0 * JOINT / TILE);
    vec2 drawn = clamp(target, deriv, vec2(0.5));
    vec2 edge = 1.0 - abs(fract(uv) * 2.0 - 1.0);
    vec2 lines = smoothstep(drawn + deriv * 1.5, drawn - deriv * 1.5, edge);
    lines *= clamp(target / drawn, 0.0, 1.0);
    lines = mix(lines, target, clamp(deriv * 2.0 - 1.0, 0.0, 1.0));
    return mix(lines.x, 1.0, lines.y);
  }

  void main() {
    vec2 uv = (vWorldXZ - BATH_XZ) / TILE + 0.5;

    // Broad mottling plus a finer rotated layer, so neither scale shows its repeat.
    const mat2 turn = mat2(0.809, -0.588, 0.588, 0.809);
    float mottle = texture2D(uFloorNoise, vWorldXZ / 23.0).r * 0.68
      + texture2D(uFloorNoise, turn * vWorldXZ / 3.7).r * 0.32;
    // A slightly different tone per tile, as laid stone or porcelain has.
    float tone = fract(sin(dot(floor(uv), vec2(41.3, 289.1))) * 43758.5453);

    // Painted light, in linear: the stage spot around the tub and the two panel
    // lights over the props.
    float light = 0.0016
      + 0.045 * pool(BATH_XZ, 26.0, 1.9)
      + 0.009 * pool(vec2(-13.0, -21.0), 17.0, 1.6)
      + 0.009 * pool(vec2(11.0, -14.0), 16.0, 1.6);
    vec3 color = uTint * light * uLevel;
    color *= (0.8 + 0.4 * mottle) * (0.86 + 0.28 * tone);

    // Contact shadow under the tub's base, then the grout.
    float contact = length((vWorldXZ - BATH_XZ) / vec2(4.8, 3.0));
    color *= 1.0 - 0.6 * smoothstep(1.0, 0.3, contact);
    color *= 1.0 - 0.72 * joints(uv);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>

    // Dissolve into the canvas's black before the plane ends, so there is no
    // horizon line.
    gl_FragColor.rgb *= 1.0 - smoothstep(30.0, 62.0, length(vWorldXZ - BATH_XZ));

    // Interleaved gradient noise, +-0.5 of an 8-bit level.
    float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    gl_FragColor.rgb += (dither - 0.5) / 255.0;
  }
`;

export function Floor() {
  const { material, noise } = useMemo(() => {
    const noise = makeNoiseTexture();
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT_WORLD_XZ,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uFloorNoise: { value: noise },
        // Cool slate, away from the green-grey the room's props and towels sit in.
        uTint: { value: new THREE.Color("#aab6c6") },
        uLevel: { value: 0 },
      },
    });
    return { material, noise };
  }, []);

  useEffect(
    () => () => {
      material.dispose();
      noise.dispose();
    },
    [material, noise],
  );

  // The painted light follows the room: up with the entrance, down to a floor at
  // the finale, as the real lights do.
  useFrame(() => {
    const { progress, introAt } = useProgressStore.getState();
    const up = E.expoOut(stage(introSeconds(introAt), LIGHTS.fill));
    material.uniforms.uLevel.value = up * (0.3 + 0.7 * roomLevel(progress));
  });

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]} material={material}>
      <planeGeometry args={[140, 140]} />
    </mesh>
  );
}
