"use client";

import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { formatARS, waLink } from "@/lib/site";
import type { Service } from "@/lib/types";

const grid: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const card: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

export function Plans({ services }: { services: Service[] }) {
  return (
    <section
      id="planes"
      className="relative scroll-mt-16 border-t border-border bg-black px-5 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="eyebrow">Elegí y reservá</p>
          <h2 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-6xl">
            Planes
          </h2>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
            Disponibilidad real, en vivo. Reservás en un toque y pagás online.
          </p>
        </motion.div>

        {services.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-dashed border-border bg-surface p-12 text-center text-fg-muted">
            Pronto vas a poder reservar online. Mientras tanto,{" "}
            <a
              href={waLink("Hola! Quiero reservar un turno.")}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline underline-offset-4"
            >
              escribinos por WhatsApp
            </a>
            .
          </div>
        ) : (
          <motion.div
            variants={grid}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-10%" }}
            className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          >
            {services.map((s) => (
              <motion.div
                key={s.id}
                variants={card}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-6 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-[0_24px_60px_-30px_rgba(97,179,59,0.55)]"
              >
                {/* hover glow */}
                <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
                <h3 className="relative text-xl font-semibold text-fg">
                  {s.name}
                </h3>
                {s.description && (
                  <p className="relative mt-2 flex-1 text-sm leading-relaxed text-fg-muted">
                    {s.description}
                  </p>
                )}
                <div className="relative mt-6 flex items-end justify-between">
                  <span className="font-mono text-3xl font-semibold tracking-tight text-fg">
                    {formatARS(s.price_ars)}
                  </span>
                  <span className="chip bg-surface-2 font-mono text-fg-muted">
                    {s.duration_minutes} min
                  </span>
                </div>
                <Link
                  href={`/reservar/${s.id}`}
                  className="btn-primary relative mt-6 w-full py-3"
                >
                  Reservar
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </section>
  );
}
