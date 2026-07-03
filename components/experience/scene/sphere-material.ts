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
  uFlow: { value: number }; // conveyor parameter: scroll + slow time drift
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
    roughness: 0.45,
    metalness: 0.0,
    envMapIntensity: 0.5,
    // Barely translucent (depthWrite stays on — one instanced draw call, so
    // real sorting isn't possible anyway).
    transparent: true,
    opacity: 0.97,
  });

  const uniforms: SphereUniforms = {
    uTime: { value: 0 },
    uRise: { value: 0 },
    uFlow: { value: 0 },
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
        attribute vec3 aColumn; // (radius, angle, isColumn) — helix slot in the flux
        attribute float aDelay;
        attribute float aTouchTime;
        uniform float uTime;
        uniform float uRise;
        uniform float uFlow;
        uniform float uAssembly;
        varying vec3 vTint;
        varying float vGreen;
        varying float vDim;
        varying float vAlpha;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec3 base = instanceMatrix[3].xyz;
          float s = max(0.0001, length(instanceMatrix[0].xyz));

          // idle drift + scroll rise
          // Slow, weightless drift — cinematic calm, not particle jitter.
          float phase = aRandom.x * 6.2831853;
          float speed = 0.12 + aRandom.y * 0.2;
          float sway  = 0.16 + aRandom.z * 0.34;
          vec3 drift = vec3(
            sin(uTime * speed + phase) * sway,
            cos(uTime * speed * 0.8 + phase * 1.3) * sway * 0.6,
            sin(uTime * speed * 0.6 + phase * 0.7) * sway
          );
          // FLOW target: column spheres ride an endless HELICAL conveyor above
          // the basin — recycling y via fract(), swirling slowly, the column
          // widening slightly as it climbs (organic, not a hard cylinder).
          // Ambient spheres (aColumn.z = 0) simply hold their scattered spot.
          float ft = fract(aRandom.w + uFlow * (0.7 + aRandom.x * 0.6));
          float ang = aColumn.y + uTime * (0.04 + 0.06 * aRandom.y) + ft * 1.2;
          float rad = aColumn.x * (0.72 + 0.55 * ft);
          vec3 columnFlow = vec3(rad * cos(ang), mix(-4.5, 36.0, ft), -6.0 + rad * sin(ang));
          vec3 flowPos = mix(aFloat, columnFlow, aColumn.z);

          // RISE (uRise 0->1): pour out of the basin along a staggered bezier
          // whose END is the sphere's LIVE conveyor slot — rising and flowing
          // are one continuous motion, no seam between phases. The WIDE stagger
          // (0.6) is what makes it a stream rather than an explosion.
          float rp = clamp(uRise * 1.6 - aDelay * 0.6, 0.0, 1.0);
          rp = 1.0 - pow(1.0 - rp, 3.0);
          vec3 columnPt = vec3(base.x * 0.6, 0.5, base.z);
          vec3 driftPos = mix(mix(base, columnPt, rp), mix(columnPt, flowPos, rp), rp) + drift;

          // ASSEMBLY: staggered ease-out-quint morph to the logo target. High-delay
          // spheres morph last — the ones that just passed the camera fly back in
          // front and merge into the mark.
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

          // Organic variety: opacity/brightness vary per sphere (a few catch
          // highlights), but the floor is HIGH — presence, not ghosts. Both ease
          // back to full as the mark assembles, so the logo stays solid.
          float aVar = 0.55 + 0.45 * pow(aRandom.z, 2.0);
          float dVar = 0.62 + 0.38 * aRandom.y;
          vAlpha = mix(aVar, 1.0, ap);
          vDim = mix(dVar, 1.0, ap);
        }`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec3 uAccent;
        varying vec3 vTint;
        varying float vGreen;
        varying float vDim;
        varying float vAlpha;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= vTint * vDim;
        diffuseColor.a *= vAlpha;
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
