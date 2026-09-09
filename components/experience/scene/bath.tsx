"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

// The floor plane in lighting.tsx.
const FLOOR_Y = -5;
const SCALE = 9;

/**
 * Bounds of `root`'s meshes in ROOT-LOCAL space, i.e. ignoring whatever
 * transform `root` itself is currently carrying.
 *
 * This has to be transform-invariant. `useGLTF` hands back a shared, cached
 * object and `<primitive>` writes position/scale straight onto it, so a plain
 * `Box3().setFromObject(scene)` measures a scene that ALREADY has scale 9 baked
 * in from a previous mount — the derived ground height then compounds by 9× per
 * remount and throws the model far out of frame.
 */
function localBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const toLocal = new THREE.Matrix4();
  const scratch = new THREE.Box3();
  root.updateWorldMatrix(false, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const gb = mesh.geometry.boundingBox;
    if (!gb) return;
    toLocal.multiplyMatrices(inv, mesh.matrixWorld);
    box.union(scratch.copy(gb).applyMatrix4(toLocal));
  });
  return box;
}

// The recovery-bath centerpiece, treated like a premium product shot: mostly
// dark, but its curves always readable — never a flat black silhouette. The
// texture is washed toward a deep anodized tone (local contrast survives), with
// micro-roughness variation so speculars feel like matte metal/polymer instead
// of perfect CGI, and a faint COOL fresnel lift as silhouette insurance (green
// is reserved for the scattered light and particles, not the product).
export function Bath() {
  const { scene } = useGLTF("/model-bath-2.glb");

  const { prepared, groundY } = useMemo(() => {
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
    // Sit the tub ON the floor instead of trusting a hand-tuned y. The model's
    // local bbox is y −0.2559..0.2598, so at scale 9 the old y of −3 buried its
    // base 0.30 BELOW the floor plane — the floor cut through the tub, and from
    // the near-level hero camera the base ended in a hard silhouette with no
    // ground under it.
    const box = localBounds(scene);
    // −2.7 is that measurement; the fallback keeps a degenerate bbox (an empty
    // or not-yet-uploaded geometry) from producing NaN and losing the model.
    const groundY = Number.isFinite(box.min.y)
      ? FLOOR_Y - box.min.y * SCALE
      : -2.7;
    return { prepared: scene, groundY };
  }, [scene]);

  // STATIC: the bath rests on the floor, sharing the ground with the room props.
  // The CAMERA does all the traveling — it orbits from a distant 30° view up to
  // the bath's zenith (see rig.tsx).
  return (
    <primitive
      object={prepared}
      position={[0, groundY, -6]}
      scale={SCALE}
      rotation={[0, 0, 0]}
    />
  );
}

useGLTF.preload("/model-bath-2.glb");
