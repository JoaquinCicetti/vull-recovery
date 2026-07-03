"use client";

/* eslint-disable react-hooks/purity, react-hooks/immutability --
   Procedural WebGL: Math.random() seeds the instance buffers once in useMemo, and
   useFrame mutates uniforms/attributes every frame by design. The React Compiler
   purity/immutability rules don't model this pattern. */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";
import { E } from "@/lib/experience/easing";
import { makeSphereMaterial } from "./sphere-material";
import { sampleLogoTargets } from "./logo-targets";

// One InstancedMesh of weightless spheres. Base position + scale baked into
// instanceMatrix once; drift/rise/assembly all run in the shader. Logo targets are
// sampled async from /logo.svg and uploaded into the aTarget/aTint attributes.
export function Spheres({ count = 1600 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const targetsReady = useRef(false);
  const { mat, uniforms } = useMemo(() => makeSphereMaterial(), []);
  // Pointer in NDC; `active` gates the touch glow (only while over the hero).
  const pointer = useRef({ x: 0, y: 0, active: false, fresh: true });
  const pick = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
      ndc: new THREE.Vector2(),
      hit: new THREE.Vector3(),
    }),
    [],
  );

  // Listeners on window so the HeroIntro/Captions overlays can't block them. Touch
  // pushes only while the finger is down; the mouse pushes whenever it moves over
  // the hero.
  useEffect(() => {
    const ptr = pointer.current;
    const update = (e: PointerEvent) => {
      ptr.x = (e.clientX / window.innerWidth) * 2 - 1;
      ptr.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    const onMove = (e: PointerEvent) => {
      if (window.scrollY > 2) {
        ptr.active = false;
        return;
      }
      update(e);
      if (e.pointerType === "mouse") activate();
    };
    const activate = () => {
      if (!ptr.active) ptr.fresh = true;
      ptr.active = true;
    };
    const onDown = (e: PointerEvent) => {
      if (window.scrollY > 2) return;
      update(e);
      activate();
    };
    const deactivate = () => {
      ptr.active = false;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") deactivate();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", deactivate);
    window.addEventListener("blur", deactivate);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", deactivate);
      window.removeEventListener("blur", deactivate);
    };
  }, []);

  const { geo, bases, floats, scales } = useMemo(() => {
    // Detail 2 (~320 tris) instead of 3 (~1280): a 4x triangle cut that is
    // imperceptible at the sub-0.14-unit on-screen sphere size.
    const g = new THREE.IcosahedronGeometry(1, 2);
    const bases = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const aRandom = new Float32Array(count * 4);
    const aDelay = new Float32Array(count);
    const floats = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // ~16% are "ambient" spheres scattered wide through the room for depth (some
      // at the lens, some deep in the fog); base ≈ float, so the rise barely moves
      // them — the shader drift keeps them wandering forever. The rest form the
      // FLUX: they pool at 1/4 of the bath's height from its bottom (bath sits on
      // the floor at y −5, 8.1 tall → band around y −3) and rise as a tall vertical
      // COLUMN above the basin (aFloat), which the conveyor then recycles upward.
      if (Math.random() < 0.16) {
        const fx = (Math.random() * 2 - 1) * 9.5;
        const fy = -5 + Math.random() * 10;
        const fz = -9 + Math.random() * 17;
        floats[i * 3] = fx;
        floats[i * 3 + 1] = fy;
        floats[i * 3 + 2] = fz;
        bases[i * 3] = fx;
        bases[i * 3 + 1] = fy;
        bases[i * 3 + 2] = fz;
      } else {
        // Column above the bath: tight radius, spanning from the basin up past
        // the zenith camera (~y 10) so the flux visibly intercepts it.
        floats[i * 3] = (Math.random() * 2 - 1) * 2.8;
        floats[i * 3 + 1] = -4 + Math.random() * 20;
        floats[i * 3 + 2] = -6 + (Math.random() * 2 - 1) * 2.8;
        // Origin: pooled inside the basin, 1/4 height from the bottom.
        bases[i * 3] = (Math.random() * 2 - 1) * 2.2;
        bases[i * 3 + 1] = -3.0 + (Math.random() * 2 - 1) * 0.6;
        bases[i * 3 + 2] = -6 + (Math.random() * 2 - 1) * 1.8;
      }
      // Power-law sizes: mostly fine particles, a few large hero spheres.
      scales[i] = 0.035 + Math.pow(Math.random(), 1.7) * 0.19;
      aRandom[i * 4] = Math.random();
      aRandom[i * 4 + 1] = Math.random();
      aRandom[i * 4 + 2] = Math.random();
      aRandom[i * 4 + 3] = Math.random();
      aDelay[i] = Math.random();
    }
    g.setAttribute("aRandom", new THREE.InstancedBufferAttribute(aRandom, 4));
    g.setAttribute("aDelay", new THREE.InstancedBufferAttribute(aDelay, 1));
    // aTarget defaults to base (no-op morph) and aTint to white until the logo loads.
    g.setAttribute("aTarget", new THREE.InstancedBufferAttribute(bases.slice(), 3));
    g.setAttribute(
      "aTint",
      new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3),
    );
    // Per-instance "last touched" timestamp for the cursor glow (-1000 = never).
    g.setAttribute(
      "aTouchTime",
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1000), 1),
    );
    // Wide "floating across the screen" anchor the spheres rise/expand toward.
    g.setAttribute("aFloat", new THREE.InstancedBufferAttribute(floats, 3));
    return { geo: g, bases, floats, scales };
  }, [count]);

  // Bake instance matrices once.
  const setRef = (mesh: THREE.InstancedMesh | null) => {
    if (!mesh || mesh === meshRef.current) return;
    meshRef.current = mesh;
    const dummy = new THREE.Object3D();
    const white = new THREE.Color("#eef0ec");
    const green = new THREE.Color("#5aa83a");
    for (let i = 0; i < count; i++) {
      dummy.position.set(bases[i * 3], bases[i * 3 + 1], bases[i * 3 + 2]);
      dummy.scale.setScalar(scales[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // ~5% of the spheres are green.
      mesh.setColorAt(i, Math.random() < 0.05 ? green : white);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Sample logo targets (async) and upload into the attributes. Deferred to idle:
  // the SVG parse + surface-sampler build + `count` samples is heavy synchronous
  // main-thread work, and the targets are only needed at the assembly phase — the
  // rise uses the no-op default targets, so this must not block the first scroll.
  useEffect(() => {
    let alive = true;
    const run = () => {
      sampleLogoTargets(count)
        .then(({ positions, tints }) => {
          if (!alive) return;
          const t = geo.getAttribute("aTarget") as THREE.InstancedBufferAttribute;
          const c = geo.getAttribute("aTint") as THREE.InstancedBufferAttribute;
          (t.array as Float32Array).set(positions);
          (c.array as Float32Array).set(tints);
          t.needsUpdate = true;
          c.needsUpdate = true;
          targetsReady.current = true;
        })
        .catch(() => {
          /* keep no-op targets — spheres just won't assemble */
        });
    };
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const id = ric ? ric(run, { timeout: 1200 }) : window.setTimeout(run, 200);
    return () => {
      alive = false;
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void })
        .cancelIdleCallback;
      if (ric && cic) cic(id);
      else clearTimeout(id);
    };
  }, [geo, count]);

  useFrame((state) => {
    const p = useProgressStore.getState().progress;
    const riseVal = E.expoOut(phaseLocal(p, PHASES.rise));
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uRise.value = riseVal;
    // Stream blend + conveyor parameter: scroll scrubs the flow, and a slow time
    // term keeps it running forever while the user holds mid-scene.
    uniforms.uFlowIn.value = E.inOutSine(phaseLocal(p, PHASES.flow));
    uniforms.uFlow.value = p * 2.2 + state.clock.elapsedTime * 0.02;
    uniforms.uAssembly.value = targetsReady.current
      ? phaseLocal(p, PHASES.assembly)
      : 0;

    // Cursor touch: stamp aTouchTime on spheres near the pointer (the shader glows
    // them green, then fades back over ~3s). Check each sphere's CURRENT x/y —
    // interpolated base→float by rise — so it tracks them whether pooled in the
    // bath or spread across the screen.
    const ptr = pointer.current;
    if (ptr.active) {
      pick.ndc.set(ptr.x, ptr.y);
      pick.raycaster.setFromCamera(pick.ndc, state.camera);
      if (pick.raycaster.ray.intersectPlane(pick.plane, pick.hit)) {
        const hx = pick.hit.x;
        const hy = pick.hit.y;
        const now = state.clock.elapsedTime;
        const touch = geo.getAttribute("aTouchTime") as THREE.InstancedBufferAttribute;
        const arr = touch.array as Float32Array;
        const r2 = 1.1 * 1.1;
        let changed = false;
        for (let i = 0; i < count; i++) {
          const cx = bases[i * 3] + (floats[i * 3] - bases[i * 3]) * riseVal;
          const cy = bases[i * 3 + 1] + (floats[i * 3 + 1] - bases[i * 3 + 1]) * riseVal;
          const dx = cx - hx;
          const dy = cy - hy;
          if (dx * dx + dy * dy < r2) {
            arr[i] = now;
            changed = true;
          }
        }
        if (changed) touch.needsUpdate = true;
      }
    }
  });

  return (
    <instancedMesh ref={setRef} args={[geo, mat, count]} frustumCulled={false} />
  );
}
