"use client";

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
  // Pointer in NDC; `active` gates the repulsion strength, `fresh` snaps uPointer to
  // the first hit so the push doesn't sweep in from the origin.
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

  const { geo, bases, scales } = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 3);
    const bases = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const aRandom = new Float32Array(count * 4);
    const aDelay = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Spread across the full width. Only ~5% float in the hero; the rest are
      // stacked below the viewport and enter from the bottom as you scroll.
      bases[i * 3] = (Math.random() * 2 - 1) * 9.5;
      bases[i * 3 + 1] =
        i < count * 0.05 ? -2 + Math.random() * 6 : -9 - Math.random() * 17;
      bases[i * 3 + 2] = (Math.random() * 2 - 1) * 3.2;
      scales[i] = 0.04 + Math.random() * 0.095;
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
    return { geo: g, bases, scales };
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

  // Sample logo targets (async) and upload into the attributes.
  useEffect(() => {
    let alive = true;
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
    return () => {
      alive = false;
    };
  }, [geo, count]);

  useFrame((state, dt) => {
    const p = useProgressStore.getState().progress;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uRise.value = E.expoOut(phaseLocal(p, PHASES.rise));
    uniforms.uAssembly.value = targetsReady.current
      ? phaseLocal(p, PHASES.assembly)
      : 0;

    // Project the pointer onto the z=0 plane every frame (the camera moves via the
    // rig) and damp the uniforms so the push eases in/out.
    const ptr = pointer.current;
    pick.ndc.set(ptr.x, ptr.y);
    pick.raycaster.setFromCamera(pick.ndc, state.camera);
    if (pick.raycaster.ray.intersectPlane(pick.plane, pick.hit)) {
      if (ptr.fresh) {
        uniforms.uPointer.value.copy(pick.hit);
        ptr.fresh = false;
      } else {
        uniforms.uPointer.value.lerp(pick.hit, 1 - Math.exp(-dt * 7));
      }
    }
    const target = ptr.active ? 1 : 0;
    uniforms.uPointerStrength.value +=
      (target - uniforms.uPointerStrength.value) * (1 - Math.exp(-dt * 5));
  });

  return (
    <instancedMesh ref={setRef} args={[geo, mat, count]} frustumCulled={false} />
  );
}
