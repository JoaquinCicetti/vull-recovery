"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E, lerp } from "@/lib/experience/easing";

// The recovery-bath centerpiece, presented CONCEPTUALLY: the source model is
// low-res with a typo'd texture, so instead of showing it literally we read it as
// a black monolith — texture washed almost fully out, and the silhouette defined
// by a green fresnel rim (edge light). Side lights in the scene graze it; the
// front face (where the typo lives) stays dark.
export function Bath() {
  const { scene } = useGLTF("/model-bath.glb");
  const ref = useRef<THREE.Group>(null);

  const prepared = useMemo(() => {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.roughness = 0.65;
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
             // Near-pure-black matte: the low-res texture / typo contributes ~8%.
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.03, 0.025), 0.92);`,
          )
          .replace(
            "#include <opaque_fragment>",
            `#include <opaque_fragment>
             // Green rim light: silhouette read — the shape pops at grazing angles
             // while faces pointing at the camera stay black. Uses the local
             // \`normal\` from normal_fragment_begin (NOT the vNormal varying: this
             // GLB ships without vertex normals, so three flat-shades it and never
             // declares vNormal — referencing it kills the shader compile).
             float rim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.5);
             gl_FragColor.rgb += vec3(0.42, 0.60, 0.47) * rim * 0.38;`,
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
