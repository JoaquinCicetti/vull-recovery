"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { Water } from "./water";

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
// a faint COOL fresnel lift as silhouette insurance (green
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
          // No roughness jitter. It hashed the VIEW-space normal, and this GLB is
          // flat-shaded, so every camera move re-rolled whole faces darker or
          // lighter: blocky patches flickering across the tub on scroll.
          //
          // NaN guard. With no vertex normals, three derives each pixel's normal
          // from cross(dFdx, dFdy) of the view position; on a sliver or edge-on
          // triangle that cross is zero and normalize() returns NaN. One NaN
          // pixel is enough: Bloom's mip chain spreads it into big black
          // rectangles for that frame — the black squares flashing on scroll.
          .replace(
            "#include <normal_fragment_begin>",
            `#include <normal_fragment_begin>
             if (any(isnan(normal)) || dot(normal, normal) < 1e-8) normal = vec3(0.0, 0.0, 1.0);`,
          )
          .replace(
            "#include <opaque_fragment>",
            `#include <opaque_fragment>
             // Faint COOL fresnel lift — silhouette insurance so the product never
             // collapses into pure black. Uses the local \`normal\` from
             // normal_fragment_begin (NOT the vNormal varying: this GLB may ship
             // without vertex normals -> flat shading -> vNormal undeclared).
             float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
             gl_FragColor.rgb += vec3(0.5, 0.58, 0.56) * rim * 0.2;
             // Backstop: never hand the composer a NaN or an Inf.
             if (any(isnan(gl_FragColor.rgb))) gl_FragColor.rgb = vec3(0.0);
             gl_FragColor.rgb = min(gl_FragColor.rgb, vec3(16.0));`,
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
  //
  // The group carries the transform so <Water/> can live in the tub's local
  // space. The cached GLB root is pinned to identity: an earlier mount may have
  // left the old position/scale written onto it.
  return (
    <group position={[0, groundY, -6]} scale={SCALE}>
      <primitive object={prepared} position={[0, 0, 0]} scale={1} rotation={[0, 0, 0]} />
      <Water />
    </group>
  );
}

useGLTF.preload("/model-bath-2.glb");
