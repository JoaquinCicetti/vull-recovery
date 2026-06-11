"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useProgressStore } from "./progress-store";
import { scrollToPlans } from "./scroll-control";
import { Button } from "@/components/ui/button";

// First-screen overlay: headline copy + a centered "scroll" indicator. Fades out
// quickly as the user begins scrolling so it clears before the spheres take over.
export function HeroIntro() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = (p: number) => {
      const o = Math.max(0, 1 - p / 0.07);
      if (ref.current) {
        ref.current.style.opacity = String(o);
        ref.current.style.transform = `translateY(${(1 - o) * -18}px)`;
      }
    };
    apply(useProgressStore.getState().progress);
    return useProgressStore.subscribe((s) => apply(s.progress));
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 z-20 will-change-[opacity,transform]"
    >
      <div className="absolute inset-x-0 top-[28%] flex flex-col items-center px-6 text-center">
        <p
          className="eyebrow animate-hero-enter"
          style={{ animationDelay: "0.1s" }}
        >
          Recuperación deportiva
        </p>
        <h1
          className="mt-4 animate-hero-enter text-5xl font-extrabold leading-[1.02] tracking-tight text-balance text-shadow-hero sm:text-7xl"
          style={{ animationDelay: "0.22s" }}
        >
          Entrenás al límite.
          <br />
          Recuperá igual.
        </h1>
        <div
          className="pointer-events-auto mt-8 flex animate-hero-enter flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: "0.4s" }}
        >
          <Button size="lg" onClick={scrollToPlans}>
            Reservá tu sesión
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/planes">Conocé el proceso</Link>
          </Button>
        </div>
      </div>

      <div
        className="absolute inset-x-0 bottom-9 flex animate-hero-enter flex-col items-center gap-2 text-fg-muted"
        style={{ animationDelay: "0.62s" }}
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.28em]">
          Scroll
        </span>
        <ChevronDown className="size-5 animate-bounce" />
      </div>
    </div>
  );
}
