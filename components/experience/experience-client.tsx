"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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

const STEPS = [0, 0.5, 1]; // hero → text 1 → text 2 + logo
const LAST = STEPS.length - 1;

export function ExperienceClient() {
  const setProgress = useProgressStore((s) => s.setProgress);
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced !== false) return;
    gsap.registerPlugin(ScrollToPlugin);

    const proxy = { v: useProgressStore.getState().progress };
    const stepRef = { i: 0 };
    const busy = { v: false };
    // Animate progress to a step. Forward beats are slower (rise 2×, logo assembly
    // 1.5×); going back is quick.
    const go = (n: number) => {
      n = Math.max(0, Math.min(LAST, n));
      const forward = n - stepRef.i > 0;
      // ease-OUT (not inOut): motion starts immediately on the scroll (responsive,
      // not laggy) and settles smoothly (not abrupt). Longer, gentler forward beats
      // (power2, not power3) so the balls flow up rather than snap.
      const duration = !forward ? 0.7 : n === 1 ? 1.9 : 1.6;
      stepRef.i = n;
      busy.v = true;
      gsap.to(proxy, {
        v: STEPS[n],
        duration,
        ease: "power2.out",
        overwrite: true,
        onUpdate: () => setProgress(proxy.v),
        onComplete: () => {
          busy.v = false;
        },
      });
    };

    // Wheel: fire only on the first event of a gesture, then disarm until the
    // wheel/trackpad momentum goes quiet (~170ms). One user scroll = one step.
    let armed = true;
    let silence: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      if (window.scrollY > 2) return; // below the experience → native scroll
      const dir = e.deltaY > 0 ? 1 : -1;
      const atLastDown = stepRef.i === LAST && dir > 0;
      // Release to the plans only on a fresh, deliberate scroll — never on the
      // momentum tail of the gesture that just landed the logo (which would skip it).
      if (atLastDown && armed) return;
      e.preventDefault();
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => {
        armed = true;
      }, 170);
      if (atLastDown) return; // momentum tail at the logo: block, don't release
      // Fire once per gesture: only disarm when we actually step.
      if (armed && !busy.v && Math.abs(e.deltaY) >= 4) {
        armed = false;
        go(stepRef.i + dir);
      }
    };

    // Touch: one step per swipe (armed once per touchstart).
    let touchY = 0;
    let touchArmed = true;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
      touchArmed = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (window.scrollY > 2) return;
      const dy = touchY - (e.touches[0]?.clientY ?? 0);
      const dir = dy > 0 ? 1 : -1;
      const atLastDown = stepRef.i === LAST && dir > 0;
      // Release to the plans only on a fresh swipe, not the continuation of the one
      // that landed the logo.
      if (atLastDown && touchArmed) return;
      e.preventDefault();
      if (atLastDown) return;
      if (!touchArmed || busy.v || Math.abs(dy) < 40) return;
      touchArmed = false;
      go(stepRef.i + dir);
    };

    const onKey = (e: KeyboardEvent) => {
      if (window.scrollY > 2 || busy.v) return;
      if (["ArrowDown", "PageDown", " "].includes(e.key) && stepRef.i < LAST) {
        e.preventDefault();
        go(stepRef.i + 1);
      } else if (["ArrowUp", "PageUp"].includes(e.key) && stepRef.i > 0) {
        e.preventDefault();
        go(stepRef.i - 1);
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("keydown", onKey);

    // CTA: run the whole animation, then scroll to the plans.
    setScroller(() => {
      busy.v = true;
      stepRef.i = LAST;
      gsap.to(proxy, {
        v: 1,
        duration: 2.4,
        ease: "power2.inOut",
        overwrite: true,
        onUpdate: () => setProgress(proxy.v),
        onComplete: () => {
          busy.v = false;
          gsap.to(window, { duration: 1.5, ease: "power2.inOut", scrollTo: "#planes" });
        },
      });
    });

    return () => {
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
    </section>
  );
}
