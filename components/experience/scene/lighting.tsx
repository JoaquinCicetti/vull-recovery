"use client";

import { Environment, Lightformer } from "@react-three/drei";

// Mostly neutral studio light (realistic white spheres), with only a faint green
// kiss for brand warmth. No HDRI download — a small procedural environment.
export function Lighting() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 9, 6]} intensity={1.5} color="#f4f2ec" />
      <directionalLight position={[-7, 2, -5]} intensity={0.45} color="#20262a" />
      <Environment resolution={256}>
        <Lightformer
          intensity={1.7}
          position={[0, 4, -6]}
          scale={[12, 7, 1]}
          color="#eef0ea"
        />
        <Lightformer
          intensity={0.5}
          position={[-6, 1, 3]}
          scale={[6, 6, 1]}
          color="#7bbf63"
        />
        <Lightformer
          intensity={0.9}
          position={[5, -2, 4]}
          scale={[5, 5, 1]}
          color="#e7ebe6"
        />
      </Environment>
    </>
  );
}
