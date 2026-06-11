"use client";

import { useEffect, useRef } from "react";
import { useProgressStore } from "./progress-store";
import { PHASES, phaseLocal, phaseFade, type PhaseRange } from "@/lib/experience/config";

// Narrative copy stays in the DOM (crisp, selectable, translatable). Each caption
// fades in/out over its phase. Driven by a transient store subscribe that writes
// opacity/transform directly — no React re-render per scroll tick.
type Caption = { range: PhaseRange; eyebrow: string; title: string };

const CAPTIONS: Caption[] = [
  { range: PHASES.rise, eyebrow: "Recuperación deportiva", title: "Tu cuerpo, suspendido" },
  { range: PHASES.assembly, eyebrow: "Precisión", title: "Todo encuentra su lugar" },
];

export function Captions() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const apply = (p: number) => {
      CAPTIONS.forEach((c, i) => {
        const el = refs.current[i];
        if (!el) return;
        const lp = phaseLocal(p, c.range);
        const o = phaseFade(lp);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${(1 - o) * 14}px)`;
      });
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center pb-[14vh]">
      {CAPTIONS.map((c, i) => (
        <div
          key={c.title + i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          style={{ opacity: 0 }}
          className="absolute px-6 text-center will-change-[opacity,transform]"
        >
          <p className="eyebrow">{c.eyebrow}</p>
          <p className="mt-3 text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">
            {c.title}
          </p>
        </div>
      ))}
    </div>
  );
}
