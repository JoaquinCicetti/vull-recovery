"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

type Step = {
  n: string;
  title: string;
  body: string;
  image: string;
  alt: string;
};

const steps: Step[] = [
  {
    n: "01",
    title: "Inmersión en frío",
    body: "Agua helada para frenar la inflamación, despertar el sistema nervioso y acelerar la recuperación muscular.",
    image: "/vull-image-4.jpeg",
    alt: "Bañera de inmersión en frío con la luz verde del estudio VULL",
  },
  {
    n: "02",
    title: "Compresión y alivio muscular",
    body: "Compresión secuencial y liberación para descargar las piernas, mejorar la circulación y soltar la tensión.",
    image: "/vull-image-6.jpeg",
    alt: "Herramientas de recuperación y rodillo en el estudio VULL",
  },
  {
    n: "03",
    title: "Fotobiomodulación",
    body: "Luz roja e infrarroja para estimular la célula, reparar el tejido y reducir el dolor desde adentro.",
    image: "/vull-image-3.jpeg",
    alt: "Sesión de fotobiomodulación con luz roja sobre la pierna",
  },
  {
    n: "04",
    title: "Listo para rendir",
    body: "Volvés a entrenar con el cuerpo recuperado y la cabeza fresca. Listo para la próxima.",
    image: "/vull-image-1.jpeg",
    alt: "Estudio VULL con la bañera de frío y el logo iluminado",
  },
];

export function RecoveryJourney() {
  return (
    <section
      id="recuperacion"
      className="relative scroll-mt-16 border-t border-border py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl px-5">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl"
        >
          <p className="eyebrow">El proceso</p>
          <h2 className="mt-5 text-4xl font-extrabold leading-[1.0] tracking-tight sm:text-6xl">
            Tu camino de recuperación.
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            Cuatro estaciones pensadas para que tu cuerpo vuelva al cien. Una
            experiencia, no un trámite.
          </p>
        </motion.div>

        <div className="mt-20 flex flex-col gap-24 sm:gap-32">
          {steps.map((step, i) => (
            <JourneyBlock key={step.n} step={step} reversed={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  );
}

function JourneyBlock({ step, reversed }: { step: Step; reversed: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const rawParallax = useTransform(scrollYProgress, [0, 1], ["-6%", "6%"]);
  const parallax = reduceMotion ? "0%" : rawParallax;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 60 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-12%" }}
      transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16"
    >
      {/* Image */}
      <div
        className={`relative h-[58svh] min-h-[360px] overflow-hidden rounded-2xl border border-border bg-surface sm:h-[72svh] ${
          reversed ? "lg:order-2" : ""
        }`}
      >
        <motion.div style={{ y: parallax }} className="absolute -inset-y-[8%] inset-x-0">
          <Image
            src={step.image}
            alt={step.alt}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            quality={82}
            className="object-cover object-center"
          />
        </motion.div>
        {/* Vignette + grain for cohesion */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
        <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-overlay" />
        <span className="pointer-events-none absolute left-5 top-4 font-mono text-sm font-semibold tracking-[0.2em] text-accent">
          {step.n}
        </span>
      </div>

      {/* Copy */}
      <div className={reversed ? "lg:order-1" : ""}>
        <span className="font-mono text-6xl font-bold leading-none text-accent/90 sm:text-7xl">
          {step.n}
        </span>
        <h3 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
          {step.title}
        </h3>
        <p className="mt-4 max-w-md text-lg leading-relaxed text-fg-muted">
          {step.body}
        </p>
      </div>
    </motion.div>
  );
}
