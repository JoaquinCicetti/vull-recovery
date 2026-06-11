"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Atmospheric green "laser dot" field — a nod to the real lasers in the VULL
 * facility photos. Deliberately low density, extremely slow, soft opacity.
 * Pure canvas + rAF (no deps), DPR-aware, and silenced under reduced motion.
 */
export function HeroParticles({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    type Dot = {
      x: number;
      y: number;
      r: number;
      vy: number;
      drift: number;
      phase: number;
      twinkle: number;
      base: number;
    };
    let dots: Dot[] = [];

    const seed = () => {
      // Very low density: scales gently with viewport, capped.
      const count = Math.min(42, Math.round((width * height) / 46000));
      dots = Array.from({ length: count }, () => {
        const base = 0.12 + Math.random() * 0.35;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.6 + Math.random() * 1.6,
          vy: 0.05 + Math.random() * 0.18, // slow upward drift
          drift: (Math.random() - 0.5) * 0.12,
          phase: Math.random() * Math.PI * 2,
          twinkle: 0.004 + Math.random() * 0.01,
          base,
        };
      });
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        d.y -= d.vy;
        d.x += d.drift;
        d.phase += d.twinkle;
        if (d.y < -4) {
          d.y = height + 4;
          d.x = Math.random() * width;
        }
        if (d.x < -4) d.x = width + 4;
        if (d.x > width + 4) d.x = -4;

        const alpha = d.base * (0.55 + 0.45 * Math.sin(d.phase));
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(108, 203, 69, ${alpha})`;
        ctx.shadowColor = "rgba(108, 203, 69, 0.9)";
        ctx.shadowBlur = 6;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [reduceMotion]);

  if (reduceMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none h-full w-full ${className}`}
    />
  );
}
