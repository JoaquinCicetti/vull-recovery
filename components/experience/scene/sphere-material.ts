import * as THREE from "three";

// Sphere material: matte-white MeshStandardMaterial extended via onBeforeCompile.
// The vertex shader does everything on the GPU:
//   • idle organic drift (time)            — alive even when not scrolling
//   • global rise (uRise, scroll)          — Phase C
//   • staggered morph to the logo (uAssembly, scroll) — Phase E
//   • cursor "touch" tint: a ball glows green when the cursor is near, then eases
//     back to white over ~3s (aTouchTime is stamped on the CPU per instance).
// Base position + scale come from instanceMatrix; the offset is counter-scaled so
// drift amplitude is uniform and the sphere lands centered on its target.
export type SphereUniforms = {
  uTime: { value: number };
  uRise: { value: number };
  uAssembly: { value: number };
  uAccent: { value: THREE.Color };
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
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aRandom;
        attribute vec3 aTarget;
        attribute vec3 aFloat;
        attribute vec3 aTint;
        attribute float aDelay;
        attribute float aTouchTime;
        uniform float uTime;
        uniform float uRise;
        uniform float uAssembly;
        varying vec3 vTint;
        varying float vGreen;`,
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
          // Rise OUT of the bath and expand to full-width floating (uRise 0->1):
          // base = pooled in the (far) bath, aFloat = spread across the screen.
          vec3 driftPos = mix(base, aFloat, uRise) + drift;

          // staggered ease-out-quint morph to the logo target
          float ap = clamp((uAssembly - aDelay * 0.55) / 0.6, 0.0, 1.0);
          ap = 1.0 - pow(1.0 - ap, 5.0);
          vec3 worldPos = mix(driftPos, aTarget, ap);

          // Shrink each sphere as it lands so the assembled logo reads crisp.
          float shrink = mix(1.0, 0.46, ap);
          transformed = transformed * shrink + (worldPos - base) / s;
          vTint = mix(vec3(1.0), aTint, ap);

          // Touch glow: 1 right after the cursor passes, fading to 0 over ~3s.
          // Suppressed once the sphere assembles into the logo (uses aTint there).
          vGreen = clamp(1.0 - (uTime - aTouchTime) / 3.0, 0.0, 1.0) * (1.0 - ap);
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uAccent;
        varying vec3 vTint;
        varying float vGreen;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= vTint;
        diffuseColor.rgb = mix(diffuseColor.rgb, uAccent, vGreen * 0.85);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        float fres = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0), 3.5);
        gl_FragColor.rgb += uAccent * fres * 0.10;`,
      );
  };

  return { mat, uniforms };
}
