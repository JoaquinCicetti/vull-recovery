import * as THREE from "three";

// Sphere material: matte-white MeshStandardMaterial (clearcoat dropped — its extra
// BRDF lobe + env sampling is imperceptible on sub-0.14u spheres and one of the
// costliest fragment paths) extended via onBeforeCompile. The vertex shader does
// everything on the GPU:
//   • idle organic drift (time)            — alive even when not scrolling
//   • global rise (uRise, scroll)          — Phase C
//   • staggered morph to the logo (uAssembly, scroll) — Phase E
// Base position + scale come from instanceMatrix; the offset is counter-scaled so
// drift amplitude is uniform and the sphere lands centered on its target.
export type SphereUniforms = {
  uTime: { value: number };
  uRise: { value: number };
  uAssembly: { value: number };
  uAccent: { value: THREE.Color };
  uPointer: { value: THREE.Vector3 };
  uPointerStrength: { value: number };
};

export function makeSphereMaterial(): {
  mat: THREE.MeshStandardMaterial;
  uniforms: SphereUniforms;
} {
  // Matte-white spheres (like the recovery-bath balls): soft sheen, not glassy.
  // Per-instance color comes from instanceColor (some are green).
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#eef0ec"),
    roughness: 0.5,
    metalness: 0.0,
    envMapIntensity: 0.6,
  });

  const uniforms: SphereUniforms = {
    uTime: { value: 0 },
    uRise: { value: 0 },
    uAssembly: { value: 0 },
    uAccent: { value: new THREE.Color("#61b33b") },
    uPointer: { value: new THREE.Vector3() },
    uPointerStrength: { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aRandom;
        attribute vec3 aTarget;
        attribute vec3 aTint;
        attribute float aDelay;
        uniform float uTime;
        uniform float uRise;
        uniform float uAssembly;
        uniform vec3 uPointer;
        uniform float uPointerStrength;
        varying vec3 vTint;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 base = instanceMatrix[3].xyz;
          float s = max(0.0001, length(instanceMatrix[0].xyz));

          // idle drift + scroll rise
          float phase = aRandom.x * 6.2831853;
          float speed = 0.22 + aRandom.y * 0.38;
          float sway  = 0.16 + aRandom.z * 0.34;
          vec3 drift = vec3(
            sin(uTime * speed + phase) * sway,
            cos(uTime * speed * 0.8 + phase * 1.3) * sway * 0.6,
            sin(uTime * speed * 0.6 + phase * 0.7) * sway
          );
          float rise = uRise * (15.0 + aRandom.w * 10.0);
          vec3 driftPos = base + drift + vec3(0.0, rise, 0.0);

          // staggered ease-out-quint morph to the logo target
          float ap = clamp((uAssembly - aDelay * 0.55) / 0.6, 0.0, 1.0);
          ap = 1.0 - pow(1.0 - ap, 5.0);
          vec3 worldPos = mix(driftPos, aTarget, ap);

          // pointer repulsion — radial push in the screen plane, eased falloff
          vec2 toPtr = worldPos.xy - uPointer.xy;
          float dist = length(toPtr);
          float falloff = 1.0 - smoothstep(0.0, 2.4, dist);
          falloff *= falloff; // sharper near the cursor
          float mass = 0.7 + aRandom.z * 0.6;  // lighter balls fly further
          float hold = 1.0 - ap * 0.85;        // assembled logo barely reacts
          vec2 dir = dist > 0.0001 ? toPtr / dist : vec2(0.0);
          worldPos.xy += dir * falloff * uPointerStrength * mass * hold * 0.7;

          // Shrink each sphere as it lands so the assembled logo reads crisp.
          float shrink = mix(1.0, 0.46, ap);
          transformed = transformed * shrink + (worldPos - base) / s;
          vTint = mix(vec3(1.0), aTint, ap);
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uAccent;
        varying vec3 vTint;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= vTint;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.5);
        gl_FragColor.rgb += uAccent * fres * 0.12;`,
      );
  };

  return { mat, uniforms };
}
