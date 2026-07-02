"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";

// The recovery-bath centerpiece. The GLB is ~1 unit, centered at the origin, so we
// scale it up and drop it low so the rising spheres read as coming out of it.
// The source texture is low-res and has a typo, so we blend the map toward a flat
// matte (hides the detail/typo, reads smooth); the scene Environment gives it form.
export function Bath() {
  const { scene } = useGLTF("/model-bath.glb");

  const prepared = useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.85;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
           // Soften: wash the low-res texture / typo toward a flat matte.
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.64, 0.66), 0.6);`,
        );
      };
      mat.needsUpdate = true;
    });
    return scene;
  }, [scene]);

  return (
    <primitive object={prepared} scale={6} position={[0, -1.6, 0]} rotation={[0, 0, 0]} />
  );
}

useGLTF.preload("/model-bath.glb");
