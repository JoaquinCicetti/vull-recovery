"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Lenis from "lenis";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { StaticHero } from "./static-hero";
import { HeroIntro } from "./hero-intro";
import { Captions } from "./captions";
import { useProgressStore } from "./progress-store";
import { setLenis } from "./scroll-control";
import { STAGE_VH, PHASES, phaseLocal } from "@/lib/experience/config";

// WebGL scene is code-split and never SSR'd (three needs the DOM). Loads while the
// hero is on screen so it's warm by the time spheres start rising.
const Scene = dynamic(() => import("./scene"), { ssr: false });

// Spheres layer — the balls are the final image (they settle into the logo), so it
// stays fully visible to the end.
function SceneLayer() {
  return (
    <div className="absolute inset-0 z-10">
      <Scene />
    </div>
  );
}

// Darkens the hero toward black as the spheres rise, so the logo resolves cleanly.
function Scrim() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (p: number) => {
      if (ref.current)
        ref.current.style.opacity = String(
          phaseLocal(p, [PHASES.rise[0], PHASES.assembly[1]]) * 0.78,
        );
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);
  return (
    <div
      ref={ref}
      style={{ opacity: 0 }}
      className="pointer-events-none absolute inset-0 z-[5] bg-black"
    />
  );
}

export function ExperienceClient() {
  const stageRef = useRef<HTMLDivElement>(null);
  const setProgress = useProgressStore((s) => s.setProgress);
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced !== false) return;
    gsap.registerPlugin(ScrollTrigger);
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    setLenis(lenis);
    lenis.on("scroll", ScrollTrigger.update);
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const st = ScrollTrigger.create({
      trigger: stageRef.current!,
      start: "top top",
      end: `+=${STAGE_VH}%`,
      pin: true,
      scrub: true,
      onUpdate: (self) => setProgress(self.progress),
    });

    return () => {
      st.kill();
      lenis.destroy();
      setLenis(null);
      cancelAnimationFrame(raf);
    };
  }, [reduced, setProgress]);

  // Reduced motion: static hero + crisp logo, no scroll-jacking.
  if (reduced === true) {
    return (
      <section className="relative h-[82svh] w-full overflow-hidden bg-black">
        <StaticHero />
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center text-center">
          <p className="eyebrow">Recuperación deportiva</p>
          <p className="mt-3 text-6xl font-extrabold tracking-tight sm:text-8xl">
            VULL
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Experiencia VULL">
      <div
        ref={stageRef}
        id="stage"
        className="relative h-screen w-full overflow-hidden bg-black"
      >
        <StaticHero />
        <Scrim />
        <SceneLayer />
        <HeroIntro />
        <Captions />
      </div>
    </section>
  );
}
