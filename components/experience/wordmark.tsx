"use client";

import { useEffect, useRef } from "react";
import { useProgressStore } from "./progress-store";

// "VULL LAB" as real DOM text, beneath the assembled mark.
//
// The spheres used to morph into the whole logo — mark AND wordmark. Letter
// strokes are thin, and the sampler is area-weighted, so at the 440-sphere mobile
// count the letters broke up. The spheres now build the mark alone
// (scene/logo-loader.ts) and the type is set here: crisp at any sphere count, and
// selectable.
//
// Fades in just behind the mark finishing its assembly (PHASES.assembly ends at
// 1.0) so the wordmark lands as the last beat of the story. Driven by a transient
// store subscribe — no re-render per frame, same as <Captions/>.
const IN: [number, number] = [0.86, 0.97];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function Wordmark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (p: number) => {
      const el = ref.current;
      if (!el) return;
      const o = clamp01((p - IN[0]) / (IN[1] - IN[0]));
      el.style.opacity = String(o);
      el.style.transform = `translateY(${(1 - o) * 10}px)`;
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex justify-center">
      {/* The mark assembles centred on the origin, lifted by LOGO_Y. At the final
          camera (0,0,13.5) the visible height is ~5.74 world units — roughly
          157px per world unit at 900px tall — which puts the mark's lower edge
          just under 59%. Measured on screen, not derived: the two have to clear
          each other or the wordmark sits in the bottom row of spheres. */}
      <div
        ref={ref}
        style={{ opacity: 0 }}
        className="absolute top-[60%] flex flex-col items-center will-change-[opacity,transform]"
      >
        <p className="text-4xl font-extrabold tracking-[0.3em] text-fg/95 [text-shadow:0_2px_30px_rgba(0,0,0,0.7)] sm:text-6xl">
          VULL
        </p>
        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.5em] text-fg-muted/80 sm:text-xs">
          LAB
        </p>
      </div>
    </div>
  );
}
