"use client";

import { useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  motion,
  useScroll,
  useTransform,
  useReducedMotion,
  type Variants,
} from "framer-motion";
import { HeroParticles } from "@/components/landing/hero-particles";

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.15 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

export function Hero() {
  const ref = useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  // Apple-style: content fades and lifts as you scroll past the hero, while the
  // background keeps its slow zoom underneath.
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const rawOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const rawY = useTransform(scrollYProgress, [0, 1], [0, -90]);
  const opacity = reduceMotion ? 1 : rawOpacity;
  const y = reduceMotion ? 0 : rawY;

  return (
    <section
      ref={ref}
      className="relative min-h-[100svh] w-full overflow-hidden bg-black"
    >
      {/* ── Background photography + atmosphere ─────────────────────────── */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 animate-hero-zoom">
          <Image
            src="/vull-image-7.jpeg"
            alt="Inmersión en frío en VULL, con la luz verde y azul del estudio"
            fill
            priority
            sizes="100vw"
            quality={85}
            className="object-cover object-center"
          />
        </div>

        {/* Left-weighted scrim for headline legibility + bottom fade. */}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/75 to-black/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />

        {/* Ambient green glow, breathing. */}
        <div
          className="absolute inset-0 animate-glow-pulse"
          style={{
            background:
              "radial-gradient(circle at 70% 38%, rgba(97,179,59,0.28), transparent 60%)",
          }}
        />

        {/* Floating green laser dots. */}
        <HeroParticles className="absolute inset-0" />

        {/* Film grain. */}
        <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay" />

        {/* Vignette. */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_180px_60px_rgba(0,0,0,0.85)]" />
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <motion.div
        style={{ opacity, y }}
        className="relative z-10 mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-5 pb-28 pt-28 sm:pb-32"
      >
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="max-w-3xl"
        >
          <motion.p
            variants={item}
            className="eyebrow text-shadow-hero"
          >
            Recuperación deportiva
          </motion.p>

          <motion.h1
            variants={item}
            className="text-shadow-hero mt-6 text-5xl font-extrabold leading-[0.95] tracking-tight text-fg sm:text-7xl lg:text-8xl"
          >
            La <span className="text-accent">recuperación</span>
            <br />
            también es entrenamiento.
          </motion.h1>

          <motion.p
            variants={item}
            className="text-shadow-hero mt-7 max-w-xl text-lg leading-relaxed text-fg-muted sm:text-xl"
          >
            Inmersión en frío, fotobiomodulación y recuperación muscular
            profesional. Reservá tu sesión en segundos.
          </motion.p>

          <motion.div
            variants={item}
            className="mt-10 flex flex-wrap items-center gap-3"
          >
            <Link
              href="#planes"
              className="btn-primary px-7 py-3.5 text-base shadow-[0_8px_40px_-12px_rgba(97,179,59,0.7)]"
            >
              Reservar sesión
            </Link>
            <Link href="#recuperacion" className="btn-ghost px-7 py-3.5 text-base">
              Ver el proceso
            </Link>
          </motion.div>

          <motion.p
            variants={item}
            className="text-shadow-hero mt-10 font-mono text-xs uppercase tracking-[0.18em] text-fg-faint"
          >
            Frío · Compresión · Luz roja · Performance
          </motion.p>
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        style={{ opacity }}
        className="absolute inset-x-0 bottom-7 z-10 flex justify-center"
        aria-hidden="true"
      >
        <div className="flex flex-col items-center gap-2 text-fg-faint">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em]">
            Deslizá
          </span>
          <motion.span
            animate={reduceMotion ? undefined : { y: [0, 7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className="h-8 w-px bg-gradient-to-b from-accent to-transparent"
          />
        </div>
      </motion.div>
    </section>
  );
}
