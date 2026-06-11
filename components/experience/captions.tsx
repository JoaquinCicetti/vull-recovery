"use client";

import { useEffect, useRef } from "react";
import { useProgressStore } from "./progress-store";

// Narrative copy in the DOM (crisp, selectable). The first caption fades in/out
// around step 1; the last fades in and holds through the final logo step. Driven by
// a transient store subscribe — no React re-render per frame.
type Caption = {
  in: [number, number];
  out: [number, number] | null;
  eyebrow: string;
  title: string;
};

const CAPTIONS: Caption[] = [
  {
    in: [0.18, 0.3],
    out: [0.52, 0.6],
    eyebrow: "Recuperación deportiva",
    title: "Tu cuerpo, suspendido",
  },
  {
    in: [0.74, 0.93],
    out: null,
    eyebrow: "VULL",
    title: "Todo encuentra su lugar",
  },
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
function fade(p: number, c: Caption) {
  const i = clamp01((p - c.in[0]) / (c.in[1] - c.in[0]));
  if (!c.out) return i;
  const o = clamp01((p - c.out[0]) / (c.out[1] - c.out[0]));
  return Math.min(i, 1 - o);
}

export function Captions() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    const apply = (p: number) => {
      CAPTIONS.forEach((c, idx) => {
        const el = refs.current[idx];
        if (!el) return;
        const o = fade(p, c);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${(1 - o) * 14}px)`;
      });
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-[9vh]">
      {CAPTIONS.map((c, idx) => (
        <div
          key={c.title}
          ref={(el) => {
            refs.current[idx] = el;
          }}
          style={{ opacity: 0 }}
          className="absolute flex flex-col items-center px-6 text-center will-change-[opacity,transform]"
        >
          {/* soft darkening so the type reads against bright scene areas without a box */}
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 -m-10 blur-2xl [background:radial-gradient(60%_120%_at_50%_55%,rgba(0,0,0,0.5),transparent_72%)]"
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-accent/90 [text-shadow:0_1px_14px_rgba(0,0,0,0.6)]">
            {c.eyebrow}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-balance text-fg/95 [text-shadow:0_2px_30px_rgba(0,0,0,0.7)] sm:text-5xl">
            {c.title}
          </p>
        </div>
      ))}
    </div>
  );
}
