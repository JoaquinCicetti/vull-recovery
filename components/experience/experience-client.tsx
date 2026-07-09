"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useProgress } from "@react-three/drei";
import { gsap } from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { HeroIntro } from "./hero-intro";
import { Captions } from "./captions";
import { useProgressStore } from "./progress-store";
import { setScroller } from "./scroll-control";
import { phaseLocal } from "@/lib/experience/config";

// WebGL scene is code-split and never SSR'd (three needs the DOM).
const Scene = dynamic(() => import("./scene"), { ssr: false });

// Renders the WebGL scene and pauses its render loop when it leaves the viewport
// (scrolled down to the plans) or the tab is hidden — the single biggest perf win,
// since the scene otherwise renders full-cost forever behind the rest of the page.
function SceneLayer() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let onScreen = true;
    const sync = () => setActive(onScreen && !document.hidden);
    // Feature-detect: without IntersectionObserver, default to always-on so the
    // scene never silently freezes while visible.
    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([e]) => {
              onScreen = e.isIntersecting;
              sync();
            },
            { threshold: 0 },
          )
        : null;
    io?.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return (
    <div ref={ref} className="absolute inset-0 z-10">
      <Scene active={active} />
    </div>
  );
}

// Branded loading screen: covers the hero while the scene assets (GLB, logo
// sampling) load, then fades out. Driven by drei's global loader progress; a
// hard timeout guarantees it can never trap the user.
function LoadingScreen() {
  const { active, progress } = useProgress();
  const beginIntro = useProgressStore((s) => s.beginIntro);
  const [gone, setGone] = useState(false);
  const ready = !active && progress >= 100;

  useEffect(() => {
    if (!ready) return;
    beginIntro(); // lights come up behind the last of the fade
    const t = setTimeout(() => setGone(true), 750); // let the fade finish
    return () => clearTimeout(t);
  }, [ready, beginIntro]);
  useEffect(() => {
    // Safety: if a loader never reports (cached, or an asset 404s), release anyway.
    // beginIntro() must fire here too and not only on `ready`: the lights and the
    // camera are gated on the intro clock, so releasing the veil without starting
    // it would reveal an unlit scene, forever. beginIntro is idempotent.
    const t = setTimeout(() => {
      beginIntro();
      setGone(true);
    }, 9000);
    return () => clearTimeout(t);
  }, [beginIntro]);

  if (gone) return null;
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black transition-opacity duration-700 ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <p className="animate-pulse text-4xl font-extrabold tracking-[0.3em] text-fg">
        VULL
      </p>
      <div className="h-px w-44 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${Math.round(progress)}%` }}
        />
      </div>
    </div>
  );
}

// Darkens the hero toward black as the spheres rise, so the logo resolves cleanly.
function Scrim() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (p: number) => {
      if (ref.current) ref.current.style.opacity = String(phaseLocal(p, [0.1, 1]) * 0.78);
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
  const setProgress = useProgressStore((s) => s.setProgress);
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced !== false) return;
    // Free-camera debug mode (?debugcam): no scroll choreography — the wheel
    // belongs to OrbitControls. ?debugcam&p=0.6 freezes the act at that beat.
    const params = new URLSearchParams(window.location.search);
    if (params.has("debugcam")) {
      const pv = Number.parseFloat(params.get("p") ?? "0");
      if (Number.isFinite(pv)) setProgress(Math.min(1, Math.max(0, pv)));
      return;
    }
    gsap.registerPlugin(ScrollToPlugin);

    // Continuous progress (no discrete steps). Scroll input accumulates a TARGET in
    // [0,1]; a damped rAF loop eases the actual progress toward it, so the scene
    // flows smoothly and can be held at any point rather than snapping between beats.
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    const target = { v: useProgressStore.getState().progress };
    const current = { v: target.v };
    let cta = false;
    let raf = 0;
    const tick = () => {
      raf = 0;
      if (cta) return; // the CTA tween owns progress while it runs
      const diff = target.v - current.v;
      current.v += diff * 0.09;
      if (Math.abs(diff) < 0.0006) current.v = target.v;
      setProgress(current.v);
      if (current.v !== target.v) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && !cta) raf = requestAnimationFrame(tick);
    };
    const nudge = (d: number) => {
      target.v = clamp01(target.v + d);
      kick();
    };

    const WHEEL_SENS = 0.00085; // progress per wheel pixel — slower, calmer ride
    const TOUCH_SENS = 0.0013; // progress per touch pixel
    const atEnd = () => target.v >= 1 - 1e-4;
    const atStart = () => target.v <= 1e-4;

    // Sticky anchor at the crafted logo: once the mark assembles, downward
    // scrolling first accumulates against this budget (the scene holds — a beat
    // on the finished logo), and only then releases to the native page.
    // Scrolling back up re-arms it.
    const STICK_WHEEL = 420; // wheel px to hold before releasing
    const STICK_TOUCH = 260; // touch px
    let stick = 0;

    const onWheel = (e: WheelEvent) => {
      if (window.scrollY > 2) return; // below the experience → native scroll
      if (e.deltaY < 0) stick = 0; // going back re-arms the anchor
      if (atEnd() && e.deltaY > 0) {
        if (stick < STICK_WHEEL) {
          stick += e.deltaY;
          e.preventDefault();
          return;
        }
        return; // anchor spent → release to the plans
      }
      e.preventDefault();
      nudge(e.deltaY * WHEEL_SENS);
    };

    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (window.scrollY > 2) return;
      const y = e.touches[0]?.clientY ?? 0;
      const dy = touchY - y; // swipe up = progress forward
      touchY = y;
      if (dy < 0) stick = 0;
      if (atEnd() && dy > 0) {
        if (stick < STICK_TOUCH) {
          stick += dy;
          e.preventDefault();
          return;
        }
        return;
      }
      e.preventDefault();
      nudge(dy * TOUCH_SENS);
    };

    const onKey = (e: KeyboardEvent) => {
      if (window.scrollY > 2) return;
      if (["ArrowDown", "PageDown", " "].includes(e.key)) {
        if (atEnd()) return;
        e.preventDefault();
        nudge(e.key === "ArrowDown" ? 0.08 : 0.16);
      } else if (["ArrowUp", "PageUp"].includes(e.key)) {
        if (atStart()) return;
        e.preventDefault();
        nudge(e.key === "ArrowUp" ? -0.08 : -0.16);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);

    // CTA: run the whole animation to the logo, then scroll to the plans.
    setScroller(() => {
      cta = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      gsap.to(current, {
        v: 1,
        duration: 2.4,
        ease: "power2.inOut",
        overwrite: true,
        onUpdate: () => setProgress(current.v),
        onComplete: () => {
          target.v = 1;
          cta = false;
          gsap.to(window, { duration: 1.5, ease: "power2.inOut", scrollTo: "#planes" });
        },
      });
    });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      setScroller(null);
    };
  }, [reduced, setProgress]);

  if (reduced === true) {
    return (
      <section className="relative h-[82svh] w-full overflow-hidden bg-black">
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
    <section
      aria-label="Experiencia VULL"
      className="relative h-screen w-full overflow-hidden bg-black"
    >
      <Scrim />
      <SceneLayer />
      <HeroIntro />
      <Captions />
      <LoadingScreen />
    </section>
  );
}
