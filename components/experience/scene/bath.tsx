"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// The recovery-bath centerpiece. Starts far away in the middle of the dark room;
// as you scroll (rise phase) it moves toward the camera and sinks to the bottom
// while the spheres rise out of it and spread across the screen.
// The source texture is low-res + has a typo, so we wash it toward a near-black
// matte (detail/typo hidden); the scene Environment + green lights give it form.
export function Bath() {
  const { scene } = useGLTF("/model-bath.glb");
  const ref = useRef<THREE.Group>(null);

  const prepared = useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.7;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          `#include <map_fragment>
           // Near-black matte: wash out the low-res texture / typo.
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.035), 0.82);`,
        );
      };
      mat.needsUpdate = true;
    });
    return scene;
  }, [scene]);

  useFrame(() => {
    if (!ref.current) return;
    const rise = E.inOutSine(
      phaseLocal(useProgressStore.getState().progress, PHASES.rise),
    );
    // Far + middle → closer + sinking to the bottom as the spheres rise out.
    ref.current.position.set(0, lerp(0.5, -6.5, rise), lerp(-16, 3, rise));
  });

  return <primitive ref={ref} object={prepared} scale={6} rotation={[0, 0, 0]} />;
}

useGLTF.preload("/model-bath.glb");
