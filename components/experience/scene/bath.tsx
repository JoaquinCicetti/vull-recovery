"use client";

import { useGLTF } from "@react-three/drei";

// The recovery-bath centerpiece. The GLB is ~1 unit, centered at the origin, so we
// scale it up and drop it slightly low so the rising spheres read as coming out of
// it. It's lit by the scene Environment (env map) + lights. Tweak scale/position/
// rotation to taste — this is the first-pass mount.
export function Bath() {
  const { scene } = useGLTF("/model-bath.glb");
  return (
    <primitive
      object={scene}
      scale={6}
      position={[0, -1.6, 0]}
      rotation={[0, 0, 0]}
    />
  );
}

useGLTF.preload("/model-bath.glb");
