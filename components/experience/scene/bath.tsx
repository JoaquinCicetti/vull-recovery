"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

// The recovery-bath centerpiece, treated like a premium product shot: mostly
// dark, but its curves always readable — never a flat black silhouette. The
// texture is washed toward a deep anodized tone (local contrast survives), with
// micro-roughness variation so speculars feel like matte metal/polymer instead
// of perfect CGI, and a faint COOL fresnel lift as silhouette insurance (green
// is reserved for the scattered light and particles, not the product).
export function Bath() {
  const { scene } = useGLTF("/model-bath-2.glb");

  const prepared = useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      // Anodized metal / premium matte polymer: soft, slightly imperfect speculars.
      mat.roughness = 0.55;
      mat.metalness = 0.25;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
             // Deep anodized wash: dark, but ~40% of the source texture survives —
             // model-bath-2 has decent textures, so let the key light reveal real
             // surface detail (local contrast without global brightness).
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.055, 0.05), 0.6);`,
          )
          .replace(
            "#include <lights_physical_fragment>",
            `// Micro-roughness variation: hashed per facing direction, breaks the
             // too-perfect specular into subtle patchiness (anodized read).
             {
               float rJit = fract(sin(dot(floor(normal.xy * 60.0), vec2(12.9898, 78.233))) * 43758.5453);
               roughnessFactor = clamp(roughnessFactor * (0.86 + 0.28 * rJit), 0.05, 1.0);
             }
             #include <lights_physical_fragment>`,
          )
          .replace(
            "#include <opaque_fragment>",
            `#include <opaque_fragment>
             // Faint COOL fresnel lift — silhouette insurance so the product never
             // collapses into pure black. Uses the local \`normal\` from
             // normal_fragment_begin (NOT the vNormal varying: this GLB may ship
             // without vertex normals -> flat shading -> vNormal undeclared).
             float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
             gl_FragColor.rgb += vec3(0.5, 0.58, 0.56) * rim * 0.2;`,
          );
      };
      mat.needsUpdate = true;
    });
    return scene;
  }, [scene]);

  // STATIC: the bath sits on the floor (y −5; model is ~0.9 tall centered, so
  // scale 9 → half-height ~4.05). The CAMERA does all the traveling now — it
  // orbits from a distant 30° view up to the bath's zenith (see rig.tsx).
  return (
    <primitive
      object={prepared}
      position={[0, -3, -6]}
      scale={9}
      rotation={[0, 0, 0]}
    />
  );
}

useGLTF.preload("/model-bath-2.glb");
