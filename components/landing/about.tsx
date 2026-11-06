import { ArrowUpRight, MapPin } from "lucide-react";
import { ADDRESS, MAPS_URL, waLink } from "@/lib/site";
import { Button } from "@/components/ui/button";

// What VULL is, where it is and how it works: the home page's indexable copy
// (docs/seo.md). A server component with no reveal animation on purpose: the
// text must be readable in the first HTML response, not faded in by script.
//
// Laid out as a spec sheet (numbered rows on hairlines, mono labels), not a card
// grid: the brand is "serious training equipment" (PRODUCT.md / DESIGN.md).

type Service = { name: string; body: string; tag: string };

// Wording shared with /planes (components/landing/recovery-journey.tsx).
const SERVICES: Service[] = [
  {
    name: "Inmersión en frío",
    body: "Agua helada para frenar la inflamación, despertar el sistema nervioso y acelerar la recuperación muscular.",
    tag: "Frío",
  },
  {
    name: "Sauna",
    body: "Calor seco para relajar el músculo, activar la circulación y soltar la carga del entrenamiento.",
    tag: "Calor",
  },
  {
    name: "Compresión",
    body: "Compresión secuencial para descargar las piernas, mejorar la circulación y soltar la tensión.",
    tag: "Piernas",
  },
  {
    name: "Luz roja",
    body: "Fotobiomodulación: luz roja e infrarroja que estimula la reparación del tejido y reduce el dolor.",
    tag: "Luz",
  },
  {
    name: "Masajes y elongación",
    body: "Trabajo manual y estiramiento asistido para recuperar movilidad y descargar contracturas.",
    tag: "Manual",
  },
  {
    name: "Pilates",
    body: "Clases con horario fijo cada semana para ganar fuerza, control y postura.",
    tag: "Clases",
  },
];

// Facts only (the session briefing in lib/session-briefing.ts is the source for
// what to bring and the contraindications).
const FAQ: { q: string; a: string }[] = [
  {
    q: "¿Cómo reservo?",
    a: "Elegís un plan acá abajo, ves los horarios libres en vivo y confirmás con tu email. Sin llamadas ni mensajes.",
  },
  {
    q: "¿Cómo pago?",
    a: "Online, por transferencia, en el momento de reservar. El turno queda confirmado cuando se acredita el pago.",
  },
  {
    q: "¿Qué tengo que llevar?",
    a: "Ropa deportiva o malla, toalla, ojotas, una muda de ropa y tu botella de agua. Hay vestuarios y duchas.",
  },
  {
    q: "¿Hay contraindicaciones?",
    a: "No se recomienda el circuito con heridas abiertas, infecciones activas, hipertensión no controlada o intolerancia al frío. Si tenés dudas, escribinos antes de reservar.",
  },
];

export function About() {
  return (
    <section
      id="vull"
      aria-labelledby="vull-heading"
      className="relative scroll-mt-16 border-t border-border px-5 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <p className="eyebrow">VULL Lab · {ADDRESS.city}</p>
          <h2
            id="vull-heading"
            className="mt-5 text-4xl font-extrabold leading-[1.02] tracking-tight text-balance sm:text-6xl"
          >
            Recuperación deportiva en {ADDRESS.city}.
          </h2>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
            Frío, calor, compresión y luz en un mismo circuito, para que vuelvas a
            entrenar antes y mejor. Para quien corre, levanta o compite.
          </p>
        </div>

        {/* Services: numbered spec rows. */}
        <ol className="mt-16 border-t border-border">
          {SERVICES.map((s, i) => (
            <li
              key={s.name}
              className="grid grid-cols-[2.5rem_1fr] gap-x-4 gap-y-2 border-b border-border py-6 sm:grid-cols-[4rem_minmax(0,16rem)_1fr_auto] sm:items-baseline sm:gap-x-8"
            >
              <span className="font-mono text-sm font-semibold tracking-[0.2em] text-accent">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-xl font-bold tracking-tight sm:text-2xl">{s.name}</h3>
              <p className="col-start-2 max-w-prose leading-relaxed text-fg-muted sm:col-start-3">
                {s.body}
              </p>
              <span className="col-start-2 font-mono text-[11px] uppercase tracking-[0.22em] text-fg-faint sm:col-start-4 sm:text-right">
                {s.tag}
              </span>
            </li>
          ))}
        </ol>

        {/* Where + how. */}
        <div className="mt-20 grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="eyebrow">Dónde estamos</p>
            <address className="mt-5 not-italic">
              <span className="block text-3xl font-bold tracking-tight sm:text-4xl">
                {ADDRESS.street}
              </span>
              <span className="mt-2 block text-lg text-fg-muted">
                {ADDRESS.place} · {ADDRESS.city}, {ADDRESS.region}
              </span>
            </address>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild variant="outline" size="lg">
                <a href={MAPS_URL} target="_blank" rel="noopener noreferrer">
                  <MapPin aria-hidden="true" />
                  Cómo llegar
                </a>
              </Button>
              <Button asChild variant="ghost" size="lg">
                <a
                  href={waLink("Hola! Quiero hacer una consulta.")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Escribinos por WhatsApp
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </Button>
            </div>
          </div>

          <div className="lg:col-span-7">
            <p className="eyebrow">Preguntas frecuentes</p>
            <div className="mt-5 border-t border-border">
              {FAQ.map((f) => (
                <div key={f.q} className="border-b border-border py-5">
                  <h3 className="text-lg font-semibold tracking-tight">{f.q}</h3>
                  <p className="mt-2 max-w-prose leading-relaxed text-fg-muted">{f.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
