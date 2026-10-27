"use client";

import { Suspense, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  AdaptiveEvents,
  OrbitControls,
  PerformanceMonitor,
} from "@react-three/drei";
import * as THREE from "three";
import { INTRO_FROM } from "@/lib/experience/intro";
import { Spheres } from "./scene/spheres";
import { Lighting } from "./scene/lighting";
import { Rig } from "./scene/rig";
import { Effects } from "./scene/effects";
import { Bath } from "./scene/bath";
import { Atmosphere } from "./scene/atmosphere";
import { RoomProps } from "./scene/props";
import { Steam } from "./scene/steam";
import { SceneBoundary } from "./scene-boundary";

// A weak GPU — an integrated laptop chip, a software renderer, a mobile GPU in
// a desktop viewport — cannot fill the post stack at 1.5× DPR AND shade 1,000
// lit spheres 60 times a second; the ride stuttered hardest at the finale,
// when the camera closes on the lit floor and bath while the mark assembles.
// Decided once at mount (the composer tree and the sphere count are fixed for
// the scene's life): such a device gets DPR 1, no depth-of-field pass, fewer
// spheres and no steam. The PerformanceMonitor still steps DPR down further
// if even that slips.
function detectLowEnd(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 8) <= 4) return true;
    if ((nav.deviceMemory ?? 8) <= 4) return true;
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /Intel|SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Radeon\(TM\) (Vega|Graphics)/i.test(
      renderer,
    );
  } catch {
    return false;
  }
}

// WebGL layer: spheres rise from the bottom, then morph into the logo silhouette.
// Transparent background so it composites over the static hero. ssr:false.
// `active` pauses the render loop (frameloop "never") when the hero scrolls
// offscreen or the tab is hidden — the scene stops burning the GPU while the user
// reads the plans below. Full DPR is kept while in view (crisp); anti-aliasing is
// the EffectComposer's multisampling (canvas antialias off would be redundant).
export default function Scene({
  active = true,
  onAlive,
}: {
  active?: boolean;
  /**
   * Reports whether WebGL is actually running. True once the renderer exists,
   * false again on `webglcontextlost`. The parent uses it to release the scroll
   * hijack — otherwise a dead canvas leaves the visitor stuck at the top of a
   * black page.
   */
  onAlive?: (alive: boolean) => void;
}) {
  const isMobile =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 768px)").matches;
  // The wide lens is about ASPECT, not device: a portrait phone sees almost
  // nothing sideways at fov 24. A narrow or zoomed desktop window also matches
  // the max-width query, and it must keep the desktop framing — so the lens
  // and the hero aim only change when the viewport is genuinely portrait.
  const portrait =
    isMobile &&
    typeof window !== "undefined" &&
    window.innerHeight > window.innerWidth;
  const [lowEnd] = useState(() => !isMobile && detectLowEnd());
  const count = isMobile ? 440 : lowEnd ? 600 : 1000;
  // Free-camera debug mode (?debugcam): OrbitControls instead of the scripted
  // Rig, plus a button that alerts the current camera position/direction — for
  // finding framings by hand. Combine with ?debugcam&p=0.6 to freeze a beat
  // (see experience-client.tsx).
  const debugCam =
    typeof window !== "undefined" &&
    window.location.search.includes("debugcam");
  const camRef = useRef<THREE.Camera | null>(null);
  // Every post pass and render target is allocated at dpr², so this is the
  // cheapest lever under load. Start at 1.5 (SMAA handles the edges) and let
  // PerformanceMonitor drop us to 1 if the frame budget slips. We never climb
  // back — re-inclining thrashes the render targets.
  const [dpr, setDpr] = useState(isMobile || lowEnd ? 1 : 1.5);
  // Under sustained load a weak GPU goes below native resolution: softer, but
  // the ride keeps moving. A strong one just loses the 1.5× supersampling.
  const declineDpr = lowEnd ? 0.75 : 1;

  return (
    <>
    <Canvas
      onCreated={(state) => {
        camRef.current = state.camera;
        onAlive?.(true);
        // A GPU reset (thermal throttling on a phone, driver hiccup) otherwise
        // leaves a permanently black hero AND a scroll lock, with nothing thrown
        // for the error boundary to catch.
        const canvas = state.gl.domElement;
        canvas.addEventListener(
          "webglcontextlost",
          (e) => {
            e.preventDefault();
            onAlive?.(false);
          },
          { once: true },
        );
        canvas.addEventListener("webglcontextrestored", () => onAlive?.(true));
      }}
      frameloop={active ? "always" : "never"}
      dpr={dpr}
      gl={{
        // Desktop AA is the composer's SMAA pass; mobile has no composer (see
        // <Effects/> below), so it needs the hardware MSAA buffer instead.
        antialias: isMobile,
        alpha: true,
        powerPreference: "high-performance",
        // Desktop: the EffectComposer forces NoToneMapping on mount, so the
        // lighting was tuned against raw linear output. Mobile renders straight
        // to the canvas, where this setting WOULD apply — keep it off there too
        // so both devices show the same grade.
        toneMapping: isMobile ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.95,
      }}
      // Long lens (~85mm equiv) on desktop: compressed perspective, shallow-focus
      // read. fov is VERTICAL, so on a portrait phone that same 24° sees only
      // ±5.6° sideways — the bath and nothing else. Portrait gets a wider lens so
      // the room (tent, boots, recliner, towels) is actually in the frame.
      // Initial position = the entry point the intro pushes in FROM, so there's no
      // first-frame pop before the Rig takes over.
      camera={{
        fov: portrait ? 56 : 24,
        near: 0.1,
        far: 200,
        position: [INTRO_FROM.x, INTRO_FROM.y, INTRO_FROM.z],
      }}
    >
      {/* Almost-black (not pure) neutral falloff: the haze gives light visible
          depth while distant geometry sinks into near-black. */}
      <fog attach="fog" args={["#050608", 24, 130]} />
      <PerformanceMonitor
        flipflops={3}
        onDecline={() => setDpr(declineDpr)}
        onFallback={() => setDpr(declineDpr)}
      />
      <Lighting />
      <SceneBoundary>
        <Suspense fallback={null}>
          <Bath />
        </Suspense>
      </SceneBoundary>
      <Atmosphere />
      {/* Background studio: sauna, compression boots + recliner, red-light
          panel, towel rack. Rendered on every device now that the phone has a
          wide enough lens to see it; the steam stays desktop-only (particle
          cost). Both are mounted from the first render so the light and material
          counts never change afterwards (which would recompile every lit
          material). Boundaried like <Bath/> — a bad shader degrades to the bare
          scene instead of taking the canvas down. */}
      <SceneBoundary>
        <RoomProps />
        {!isMobile && !lowEnd && <Steam />}
      </SceneBoundary>
      <Spheres count={count} />
      {debugCam ? <OrbitControls makeDefault target={[0, -1, -6]} /> : <Rig portrait={portrait} />}
      {/* The post stack (bloom, CA, vignette, grain, SMAA) renders every pass
          into full-screen targets. On phones that was enough to stall the frame
          loop as the mark assembled — the scene read as frozen at the logo — so
          mobile renders straight to the canvas with hardware MSAA instead. */}
      {!isMobile && <Effects dof={!lowEnd} />}
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
