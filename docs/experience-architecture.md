# VULL — Scroll-driven WebGL experience: architecture

A flagship, Apple-grade scroll story: cinematic video scrub → seamless handoff to
WebGL → weightless rising spheres → 3D logo interaction → elegant assembly reveal.

Stack reality (verified): Next 16 App Router, React 19, Tailwind v4, framer-motion.
**Not yet installed** — `three`, `@react-three/fiber@9` (R3F v9 = React 19 support),
`@react-three/drei@10`, `@react-three/postprocessing`, `gsap` (ScrollTrigger),
`lenis` (smooth scroll), `maath` (easing/noise helpers). Asset: `public/video.mp4`
(556 KB — small, so likely short/low-bitrate; **re-encode/extract**, don't scrub it raw).

---

## 0. Core architectural decision: ONE master progress, many phases

Do **not** wire each section to its own ScrollTrigger with independent state. Use a
single source of truth:

- One **pinned** container (~600–800vh of scroll) drives **one** normalized
  `progress` 0→1 written into a tiny **zustand** store (or a ref) on every
  ScrollTrigger `onUpdate`.
- The video `<canvas>` and the R3F `<Canvas>` both **read** `progress` each frame.
  They never own scroll logic. This decouples the R3F render loop from the DOM and
  makes the video→WebGL handoff a pure crossfade on a shared timeline.
- Lenis provides inertial smoothing; ScrollTrigger reads Lenis. GSAP's own
  ScrollSmoother is paid — Lenis is the free, industry-standard choice and is what
  most Awwwards sites use.

Phase map (tune later):

| Phase | progress | What happens | Owner |
|------|----------|--------------|-------|
| A — Scrub | 0.00–0.32 | Video image-sequence scrubs frame-by-frame | Canvas2D |
| B — Handoff | 0.30–0.40 | Crossfade last video frame ↔ matched WebGL frame | both |
| C — Rise | 0.38–0.60 | Spheres rise, weightless drift, camera dolly back | R3F |
| D — Logo | 0.58–0.80 | Camera threads the **V**, spheres weave the letters | R3F |
| E — Assembly | 0.78–1.00 | Spheres morph into the logo formation, settle, DoF reveal | R3F |

Overlaps (0.30–0.40, 0.58–0.60, 0.78–0.80) are deliberate so transitions are
cross-dissolves, never cuts.

---

## 1. Asset pipeline (the single biggest quality lever)

**Recommendation: image sequence drawn to `<canvas>`, NOT video scrubbing.**
This is literally Apple's technique (AirPods Pro / MacBook pages = a few hundred
JPEGs drawn to canvas). Reasons:

- `video.currentTime` seeking is **not frame-accurate** and stutters on iOS Safari
  (offscreen decode is throttled, seeks snap to keyframes). Making mp4 seek-accurate
  requires all-intra encoding (`keyint=1`) → file balloons 10–30×.
- A decoded image drawn to canvas is **deterministic, instant, identical on every
  device**. Buttery scrub guaranteed.

Pipeline (ffmpeg — install via `brew install ffmpeg`):

```bash
# Inspect first
ffprobe -v error -show_entries format=duration -of csv=p=0 public/video.mp4

# Extract ~150 frames at two widths, modern codec. AVIF best ratio, WebP best support.
mkdir -p public/seq/desktop public/seq/mobile
ffmpeg -i public/video.mp4 -vf "fps=24,scale=1600:-2" -q:v 78 public/seq/desktop/f_%04d.webp
ffmpeg -i public/video.mp4 -vf "fps=24,scale=820:-2"  -q:v 72 public/seq/mobile/f_%04d.webp
```

- **Frame count:** aim 120–200. Fewer = lighter but coarser scrub; 150 is the sweet
  spot. `fps = frames / duration`.
- **Format:** WebP (universal) or AVIF (smaller, slightly riskier Safari support —
  ship WebP, optionally `<source>` AVIF). Keep each desktop frame ~20–40 KB → ~3–6 MB
  total, progressively loaded.
- **Two tiers** (desktop 1600w, mobile 820w). Pick by `matchMedia` + DPR.
- Keep `video.mp4` only as a **reduced-motion / no-JS fallback** (autoplay muted
  playsinline poster).

**Logo geometry:** two options —
1. **SVG → extrude** at runtime: `SVGLoader` → `ExtrudeGeometry` (bevel for premium
   edge). Cheapest to author, fully procedural. Best if you have a clean `logo.svg`.
2. **Authored GLB** (Blender) → Draco-compressed. Best control over bevels/material.
Recommend (1) first; swap to (2) if you want sculpted edges. Drop `logo.svg` in
`public/` (you currently only have `logo.jpg` — a raster won't extrude cleanly).

---

## 2. Dependency + route setup

```bash
pnpm add three @react-three/fiber @react-three/drei @react-three/postprocessing \
  gsap lenis maath zustand
pnpm add -D @types/three
```

R3F v9 supports React 19. The `<Canvas>` must be a **client component**, loaded with
`next/dynamic` `{ ssr:false }` so three never runs on the server.

Route placement (recommend): a dedicated **`/experience`** route (or make it the new
`/`, keeping the current landing as the reduced-motion/low-power fallback). Decision
needed — see end.

---

## 3. File / component structure

```
app/
  experience/
    page.tsx                 // server: metadata + <ExperienceClient/> (dynamic, ssr:false)
    experience-client.tsx    // 'use client' root: Lenis + ScrollTrigger + DOM layers
components/experience/
  ScrollStage.tsx            // the pinned 800vh container; sets up the master ScrollTrigger
  progress-store.ts          // zustand: { progress, phase } + selectors
  useScrollProgress.ts       // subscribe helper for R3F components
  VideoScrub.tsx             // Canvas2D image-sequence player (Phase A)
  useImageSequence.ts        // preload + decode + draw frame(i)
  Scene.tsx                  // <Canvas> wrapper (dynamic, ssr:false) — Phases C–E
  scene/
    Rig.tsx                  // camera controller (reads progress → camera path)
    Spheres.tsx              // InstancedMesh + custom shader (drift + morph)
    Logo3D.tsx               // extruded SVG geometry + material
    Lighting.tsx             // key/fill/rim + env
    Effects.tsx              // postprocessing stack
    sphereMaterial.ts        // onBeforeCompile / TSL material
    targets.ts               // sample logo → target positions (Float32Array)
  Loader.tsx                 // drei useProgress → tasteful brand loader
  ReducedMotionFallback.tsx  // static hero / autoplay video
lib/experience/
  easing.ts                  // shared cubic-beziers
  config.ts                  // phase ranges, counts, camera keyframes
```

---

## 4. R3F scene hierarchy

```
<Canvas dpr={[1, capDPR]} gl={{ antialias:false, powerPreference:'high-performance' }}
        camera={{ fov: 32, near:0.1, far:100 }} >
  <color attach="background" args={['#000']} />
  <fog attach="fog" args={['#05130a', 8, 28]} />        // green-black depth, matches video
  <Lighting/>                                            // ambient + key(green) + rim
  <Environment preset blur />                            // low-res blurred HDRI for sphere reflections
  <Spheres/>                                             // 1 InstancedMesh, shader-driven
  <Logo3D/>                                              // extruded V U L L, hidden until Phase D
  <Rig/>                                                 // animates camera from progress
  <Effects/>                                             // bloom, DoF, vignette, grain, ACES
</Canvas>
```

Single Canvas, single InstancedMesh, single camera. Everything animates off the one
`progress` value, read per-frame inside `useFrame` (not React state — never setState
per frame).

---

## 5. Scroll system (Lenis + GSAP ScrollTrigger)

```ts
// experience-client.tsx (sketch)
const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
useEffect(() => {
  gsap.registerPlugin(ScrollTrigger);
  lenis.on('scroll', ScrollTrigger.update);
  const raf = (t:number)=>{ lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);

  const st = ScrollTrigger.create({
    trigger: '#stage', start: 'top top', end: '+=800%', pin: true, scrub: true,
    onUpdate: (self) => store.getState().setProgress(self.progress),
  });
  return () => { st.kill(); lenis.destroy(); };
}, []);
```

- `scrub: true` (not a number) because Lenis already smooths; double-smoothing lags.
- DOM text overlays (eyebrows, captions per phase) are plain absolutely-positioned
  elements faded with framer-motion driven off `progress` ranges — keep copy in DOM
  (crisp, accessible), not in WebGL.

---

## 6. Phase A — video scrub (Canvas2D)

```ts
// useImageSequence: preload all frames as ImageBitmap, draw by index
const frame = Math.min(N-1, Math.round(localProgress * (N-1)));
ctx.drawImage(bitmaps[frame], 0,0, cvs.width, cvs.height);  // cover-fit
```

- Preload **eagerly** the first ~30 frames, then the rest in the background; gate the
  ability to scroll past the hero until ≥90% decoded (show `Loader`).
- Decode with `createImageBitmap(blob)` off the main thread; store bitmaps in a ref.
- Draw on `progress` change (subscribe to store), `cover` math for any viewport,
  `devicePixelRatio`-aware canvas sizing. No video element at all on the happy path.

---

## 7. Phase B — invisible video→WebGL handoff

The cut is hidden by **matching, then crossfading**:

1. **Compose the WebGL first frame to equal the video's last frame.** Same camera FOV
   (~32), same green ambient direction, same fog/vignette, same grade. Place the
   "hero" spheres at the **screen positions** they occupy in the final video frame
   (unproject those 2D points to a plane at a chosen depth) so nothing jumps.
2. **Backplate trick:** for the first ~0.5s of WebGL, render the *actual last video
   frame* as a full-screen background texture behind the 3D spheres. The environment
   is then literally identical; only the foreground spheres are 3D. Fade the backplate
   out into the real 3D fog over phase B.
3. **Crossfade canvases:** both `<canvas>` (video) and `<Canvas>` (webgl) are stacked;
   over progress 0.30→0.40 tween video canvas `opacity 1→0` while WebGL `0→1`. Because
   the frames match, even mid-fade looks like one continuous image.
4. Match color: drive WebGL tone mapping = `ACESFilmic`, then a small color-grade pass
   (lift/gamma/gain or a LUT) tuned to the video's grade. Add the same film grain you
   use elsewhere (`.bg-noise`).

---

## 8. Phase C — weightless rising spheres

Motion model = **deterministic noise, not physics**. Per instance, in the vertex
shader:

```
pos = basePos
    + vec3(0.0, uRise * easeOutExpo(localProg), 0.0)        // global slow rise (scroll)
    + curlNoise(basePos*0.3 + uTime*0.05) * driftAmp        // organic idle drift
    + vec3(sin(uTime*0.4 + phase))*sway;                    // gentle helium sway
```

Feel = helium/water: low frequency, low amplitude, slightly damped, never linear.
Continuous `uTime` drift keeps it alive even when the user stops scrolling (so it's
never frozen). Scroll controls the *macro* rise; time controls the *micro* life.

---

## 9. Phase D — logo interaction + fly-through the V

- `Logo3D` is real extruded geometry (depth-tested), so spheres genuinely pass
  **behind/between** the letters with correct occlusion — no fakery needed.
- "Balls weaving the letters": bias the drift field with a soft attraction toward the
  letter surfaces (sample a low-res SDF of the logo, or just attract to a handful of
  anchor points along each stroke) so a subset threads through the **V** and **U**
  bowls. Keep forces gentle (premium, not swarm).
- **Camera through the V:** a `CatmullRomCurve3` whose control points enter in front
  of the V, dip through its negative space, and exit toward the LL. Camera position =
  `curve.getPoint(easeInOut(localProg))`, lookAt a target that eases from "the gap"
  to "the whole wordmark." Add a touch of **motion blur** (postprocessing) only during
  this move for cinematic weight.

---

## 10. Phase E — assembly into the logo (the money shot)

GPU morph, not CPU:

- Precompute **target positions** once: sample N points on the logo geometry
  (`MeshSurfaceSampler` from three, or sample the extruded volume) → `aTarget`
  instance attribute. Also bake `aStart` (the drifting position at handoff) and a
  per-instance `aDelay` (by distance + noise) for stagger.
- Vertex shader lerps: `p = mix(driftPos, aTarget, easeOutQuint(saturate((uProg - aDelay)/span)))`.
  Long span, heavy stagger → spheres arrive in elegant waves, with a tiny overshoot
  (`back.out(1.05)`) and settle. Not a snap, not magic.
- On arrival: tighten **DoF** focus onto the logo, lift a slow **push-in**, let bloom
  catch the rim — Apple-commercial final beat. Hold, then release scroll to a normal
  page (CTA, plans) below the pinned stage.

---

## 11. Camera paths (suggested)

| Phase | Move | Curve |
|------|------|-------|
| A | locked (matches video) | — |
| B | micro pull-back as backplate fades | expo.out |
| C | slow dolly back + 3–5° tilt up, slight parallax | inOut sine |
| D | CatmullRom thread through V, lookAt eases gap→wordmark | inOut expo |
| E | gentle push-in to hero framing, settle | out quint, then tiny out back |

One PerspectiveCamera, fov ~30–34 (longer lens = premium compression). Animate via a
`useFrame` reading `progress`; never OrbitControls.

---

## 12. Easing / curves (reuse your tokens)

You already define `--ease-out-quart` and `--ease-out-expo`. Mirror them in JS:

```ts
export const E = {
  expoOut:  (x:number)=> x===1?1:1-Math.pow(2,-10*x),                 // entrances, camera
  quintOut: (x:number)=> 1-Math.pow(1-x,5),                            // assembly arrivals
  inOutSine:(x:number)=> -(Math.cos(Math.PI*x)-1)/2,                   // drift, dolly
  backOut:  (x:number,s=1.05)=>1+ (s+1)*Math.pow(x-1,3)+s*Math.pow(x-1,2), // settle
};
```

Rule: **nothing linear except continuous idle drift and grain.** Slow, long ease-outs.
No bounce/elastic (matches DESIGN.md). Durations feel right at 1.2–2.5s equivalents
mapped onto scroll span.

---

## 13. Particle counts

| Tier | Spheres | Notes |
|------|---------|-------|
| Desktop (high) | 1200–1600 | one InstancedMesh, shader morph |
| Desktop (mid GPU) | 800 | auto-detect via `gl.capabilities` / FPS guard |
| Mobile | 350–500 | + lower DPR + no transmission/SSAO |
| Reduced motion | 0 | static fallback |

Reveal extra spheres progressively (fade in via instance alpha) as they rise, so the
video's "dozens" grows believably into "hundreds" without a pop.

---

## 14. InstancedMesh

- **One** `InstancedMesh(sphereGeo, shaderMaterial, MAX)` for everything.
- Geometry: `IcosahedronGeometry(r, 3)` (smooth, ~320 tris) — cheap, round enough.
- Per-instance attributes (InstancedBufferAttribute): `aStart`, `aTarget`, `aRandom`
  (phase/size/speed), `aDelay`. Motion lives in the **shader**, so you almost never
  touch `instanceMatrix` on the CPU (no per-frame matrix writes = fast).
- Use drei `<Instances>/<Instance>` only for the *prototype*; switch to raw
  InstancedBufferGeometry + custom attributes for the shipping shader version.

---

## 15. Shaders

- **Material:** extend `MeshPhysicalMaterial` via `onBeforeCompile` (keep PBR +
  clearcoat + env reflections) and inject: per-instance position (drift+morph),
  per-instance roughness/tint variation, a **green Fresnel rim**. Premium sphere =
  high clearcoat, low roughness, subtle `transmission`/`thickness` for a
  suspended-in-water read (desktop only — transmission is costly).
- **Vertex injects:** displace `transformed`/`mvPosition` by the computed instance
  world offset; pass `vRim = pow(1.0 - dot(N,V), 3.0)` to fragment.
- **Fragment injects:** `gl_FragColor.rgb += rim * uAccent` (your `#61b33b`).
- Consider **TSL** (three's node shaders) if you want WebGPU-readiness; otherwise GLSL
  `onBeforeCompile` is the pragmatic path today.

---

## 16. Postprocessing & premium motion design

`@react-three/postprocessing` stack (desktop): `SMAA` → `Bloom` (low intensity, high
threshold — only rims/speculars) → `DepthOfField` (off until Phase E, then focus
logo) → `Vignette` → subtle `Noise` (grain) → tone mapping `ACESFilmic`. Optional tiny
`ChromaticAberration` (≤0.0008) at edges. Mobile: SMAA + vignette + grain only.

Premium feel checklist: deep blacks (matte-black brand), one green accent in light not
geometry, long lenses, slow ease-outs, DoF + faint bloom for the reveal, motion blur
only on the camera thread, unified color grade across video+WebGL, and **restraint** —
every element calm and intentional.

---

## 17. Performance

- Cap `dpr={[1, Math.min(2, devicePixelRatio)]}`; on mobile cap at 1.5.
- Keep R3F `frameloop="always"` (idle drift needs it) but **pause when the stage is
  offscreen** (IntersectionObserver → `setFrameloop('never')`).
- No per-frame React state; read `progress` from the store ref inside `useFrame`.
- Avoid `transmission` on mid/low GPUs (it re-renders the scene). Feature-detect.
- Pre-bake target positions once (not per frame). Static geometry, static attributes.
- Budget: 60fps desktop, 30–60 mobile. Add an FPS guard that drops count/DPR if the
  rolling average dips (drei `PerformanceMonitor`).

## 18. Mobile

- Image-sequence mobile tier (820w), fewer frames acceptable.
- 350–500 spheres, DPR ≤1.5, cheaper material (no transmission/SSAO), bloom low.
- iOS: the image-sequence approach sidesteps all video-decode pain. If you ever keep a
  real `<video>` fallback it MUST be `muted playsInline`.
- Touch scroll via Lenis (`smoothTouch:false` recommended — smoothing touch feels
  laggy; let native momentum drive ScrollTrigger).
- Test thermal throttling; provide the reduced-motion fallback as the floor.

## 19. Loading strategy

1. Server sends light shell + `Loader` immediately.
2. Eager-decode first ~30 sequence frames → start scrub ASAP.
3. In parallel, `next/dynamic` import the R3F `Scene` bundle (three is heavy ~150KB
   gz) **while the user scrubs the video**, so WebGL is warm before Phase B.
4. drei `useProgress` for HDRI/logo/GLB; gate Phase B until assets + ≥90% frames ready.
5. Preload the env map small + blurred; Draco for any GLB.

## 20. Reduced motion / accessibility

- `prefers-reduced-motion` (your app already respects it): render
  `ReducedMotionFallback` — a static hero frame (or the muted autoplay video) plus the
  normal page, no scroll-jacking. This is both an a11y requirement and the low-power
  floor.
- Keep all narrative **copy in the DOM** so it's selectable, translatable, indexable.

---

## Build milestones (suggested order)

1. Deps + `/experience` route + Lenis/ScrollTrigger + progress store + pinned stage.
2. Asset pipeline (ffmpeg) + `VideoScrub` Phase A (ship this alone — already feels premium).
3. R3F Canvas + lighting + ONE InstancedMesh of drifting spheres (Phase C), matched grade.
4. Phase B handoff (backplate + crossfade) — tune until invisible.
5. `Logo3D` + camera-through-V (Phase D).
6. GPU morph assembly + DoF/bloom reveal (Phase E).
7. Postprocessing polish, FPS guard, mobile tier, reduced-motion fallback.
8. Perf pass + real-device testing.

Each milestone is independently shippable and reviewable.
