"use client";

import { Suspense, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveEvents, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Spheres } from "./scene/spheres";
import { Lighting } from "./scene/lighting";
import { Rig } from "./scene/rig";
import { Effects } from "./scene/effects";
import { Bath } from "./scene/bath";
import { Atmosphere } from "./scene/atmosphere";

// WebGL layer: spheres rise from the bottom, then morph into the logo silhouette.
// Transparent background so it composites over the static hero. ssr:false.
// `active` pauses the render loop (frameloop "never") when the hero scrolls
// offscreen or the tab is hidden — the scene stops burning the GPU while the user
// reads the plans below. Full DPR is kept while in view (crisp); anti-aliasing is
// the EffectComposer's multisampling (canvas antialias off would be redundant).
export default function Scene({ active = true }: { active?: boolean }) {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  const count = isMobile ? 440 : 1000;
  // Free-camera debug mode (?debugcam): OrbitControls instead of the scripted
  // Rig, plus a button that alerts the current camera position/direction — for
  // finding framings by hand. Combine with ?debugcam&p=0.6 to freeze a beat
  // (see experience-client.tsx).
  const debugCam =
    typeof window !== "undefined" &&
    window.location.search.includes("debugcam");
  const camRef = useRef<THREE.Camera | null>(null);

  return (
    <>
    <Canvas
      onCreated={(state) => {
        camRef.current = state.camera;
      }}
      frameloop={active ? "always" : "never"}
      dpr={[1, isMobile ? 1.5 : 2]}
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        toneMapping: THREE.ACESFilmicToneMapping,
        // Slight underexposure: the cinematic grade lives in the darks.
        toneMappingExposure: 0.9,
      }}
      // Long lens (~85mm equiv): compressed perspective, shallow-focus read.
      camera={{ fov: 24, near: 0.1, far: 100, position: [0, 0, 18] }}
    >
      {/* Pure-black falloff: objects separate via rim light, never a gradient.
          Far pushed out for the radius-60 orbit — the bath is ~60 units away. */}
      <fog attach="fog" args={["#010102", 20, 120]} />
      <Lighting />
      <Suspense fallback={null}>
        <Bath />
      </Suspense>
      <Atmosphere />
      <Spheres count={count} />
      {debugCam ? <OrbitControls makeDefault target={[0, -1, -6]} /> : <Rig />}
      <Effects dof={!isMobile} />
      {/* Throttle raycasting/events while scrolling; DPR stays full for crispness. */}
      <AdaptiveEvents />
    </Canvas>
    {debugCam && (
      <button
        type="button"
        className="fixed bottom-4 right-4 z-50 rounded-md border border-white/20 bg-white/10 px-3 py-2 font-mono text-xs text-white backdrop-blur"
        onClick={() => {
          const cam = camRef.current;
          if (!cam) return;
          const dir = new THREE.Vector3();
          cam.getWorldDirection(dir);
          const pos = cam.position;
          const pivot = new THREE.Vector3(0, -1, -6); // bath center (rig PIVOT)
          const radius = pos.distanceTo(pivot);
          const elev = (Math.asin((pos.y - pivot.y) / radius) * 180) / Math.PI;
          console.log("[debugcam]", {
            position: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
            direction: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)],
            radiusFromBath: +radius.toFixed(1),
            elevationDeg: +elev.toFixed(1),
          });
        }}
      >
        cam info
      </button>
    )}
    </>
  );
}
