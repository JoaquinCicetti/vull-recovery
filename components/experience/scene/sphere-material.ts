import * as THREE from "three";

// Premium sphere material: PBR clearcoat (glassy, suspended-in-water read) extended
// via onBeforeCompile. The vertex shader does everything on the GPU:
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
};

export function makeSphereMaterial(): {
  mat: THREE.MeshPhysicalMaterial;
  uniforms: SphereUniforms;
} {
  // Realistic matte-white spheres (like the recovery-bath balls): soft sheen, not
  // glassy. Per-instance color comes from instanceColor (some are green).
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#eef0ec"),
    roughness: 0.5,
    metalness: 0.0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.45,
    envMapIntensity: 0.6,
  });

  const uniforms: SphereUniforms = {
    uTime: { value: 0 },
    uRise: { value: 0 },
    uAssembly: { value: 0 },
    uAccent: { value: new THREE.Color("#61b33b") },
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
