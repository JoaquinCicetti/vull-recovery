"use client";

import { Environment, Lightformer } from "@react-three/drei";

// Dark, moody "recovery room": low ambient, one soft key, and green accent lights
// (the app theme) that Bloom turns into a glow. A wide dark floor grounds it. Fog
// (in scene.tsx) fades everything to near-black for the smog-in-a-wide-room read.
export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.14} />
      <directionalLight position={[4, 9, 5]} intensity={0.45} color="#c7d4cc" />
      {/* WHITE key from BEHIND the camera (which sits at z ~+10). Front-lights the
          spheres white so they read as white balls (with a green rim), instead of
          the green side lights turning the whole logo green. */}
      <directionalLight position={[0, 3, 20]} intensity={1.5} color="#ffffff" />
      {/* Green accent lights — from the sides, for atmosphere + Bloom glow, NOT the
          key. Kept lower so they rim the spheres rather than flooding them green. */}
      <pointLight position={[-7, 1, 2]} intensity={7} distance={34} decay={2} color="#61b33b" />
      <pointLight position={[8, -2, -4]} intensity={4} distance={34} decay={2} color="#3e7d25" />

      <Environment resolution={64}>
        <Lightformer intensity={0.35} position={[0, 6, -10]} scale={[16, 9, 1]} color="#141c18" />
        <Lightformer intensity={0.9} position={[-6, 0, 4]} scale={[5, 8, 1]} color="#61b33b" />
        <Lightformer intensity={0.35} position={[7, -2, 4]} scale={[5, 5, 1]} color="#26332b" />
      </Environment>

      {/* Room floor — dark, faintly reflective so the green light pools on it. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -5, 0]}>
        <planeGeometry args={[140, 140]} />
        <meshStandardMaterial color="#04060a" roughness={0.5} metalness={0.15} />
      </mesh>
    </>
  );
}
