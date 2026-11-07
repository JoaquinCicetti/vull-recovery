"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ADDRESS } from "@/lib/site";
import { useProgressStore } from "./progress-store";
import { scrollToPlans } from "./scroll-control";
import { Button } from "@/components/ui/button";

// First-screen overlay as a film title band: the scene owns the frame, and a
// thin band along the bottom (over the floor, clear of the props) carries the
// headline on the left and the one action on the right. A hairline draws across
// above it as the lights come up. Fades out as soon as the user starts the ride.

// Seconds after the veil lifts (the intro clock, lib/experience/intro.ts): the
// key light rakes in from 0.65 s, so the band arrives while the room fills.
const T_RULE = 0.5;
const T_LINE_1 = 0.8;
const T_LINE_2 = 0.95;
const T_ACTION = 1.25;
const T_META = 1.5;

export function HeroIntro() {
  const ref = useRef<HTMLDivElement>(null);

  // Hold every entrance until the intro clock starts: the loading veil (z-40)
  // outlives a mount-time animation, which would otherwise finish unseen.
  const [entered, setEntered] = useState(
    () => useProgressStore.getState().introAt !== null,
  );
  useEffect(() => {
    if (entered) return;
    return useProgressStore.subscribe((s) => {
      if (s.introAt !== null) setEntered(true);
    });
  }, [entered]);
  const enter = (anim: string, delay: number) => ({
    className: entered ? anim : "opacity-0",
    style: { animationDelay: `${delay}s` },
  });

  useEffect(() => {
    const apply = (p: number) => {
      const o = Math.max(0, 1 - p / 0.07);
      if (ref.current) {
        ref.current.style.opacity = String(o);
        ref.current.style.transform = `translateY(${(1 - o) * 12}px)`;
      }
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);

  const rule = enter("animate-draw-x", T_RULE);
  const line1 = enter("animate-rise", T_LINE_1);
  const line2 = enter("animate-rise", T_LINE_2);
  const action = enter("animate-rise", T_ACTION);
  const meta = enter("animate-rise", T_META);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-20 will-change-[opacity,transform]"
    >
      {/* Floor shade: the band sits on near-black, not on the lit tiles. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black via-black/60 to-transparent"
      />

      {/* On a phone the scene sits low and the top half is empty air, so the
          band splits: headline up under the header, action at the bottom. */}
      <div className="absolute inset-x-0 top-[5.5rem] bottom-0 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:top-auto sm:pb-10">
        <div className="mx-auto flex h-full max-w-6xl flex-col px-5 sm:h-auto">
          <div
            aria-hidden="true"
            className={`hidden h-px origin-left bg-white/15 sm:block ${rule.className}`}
            style={rule.style}
          />

          <div className="flex flex-1 flex-col justify-between gap-7 sm:mt-7 sm:flex-row sm:items-end sm:gap-10">
            <h1 className="text-[length:clamp(2.25rem,3.4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-fg">
              <span className={`block ${line1.className}`} style={line1.style}>
                Entrenás al límite.
              </span>
              <span className={`block ${line2.className}`} style={line2.style}>
                Recuperá igual.
              </span>
            </h1>

            <div className="flex shrink-0 flex-col gap-4 sm:items-end">
              <div
                className={`pointer-events-auto ${action.className}`}
                style={action.style}
              >
                <Button size="lg" onClick={scrollToPlans} className="w-full sm:w-auto">
                  Reservá tu sesión
                </Button>
              </div>
              <p
                className={`flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.22em] text-fg-faint ${meta.className}`}
                style={meta.style}
              >
                <span>Recuperación deportiva · {ADDRESS.city}</span>
                <ArrowDown aria-hidden="true" className="animate-nudge size-3.5 text-accent" />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
