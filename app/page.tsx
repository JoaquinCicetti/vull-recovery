import Link from "next/link";
import { getActiveServices } from "@/lib/services";
import { formatARS, waLink, SITE_NAME } from "@/lib/site";
import { Logo } from "@/components/logo";

const steps = [
  {
    n: "01",
    title: "Elegí tu plan",
    body: "Mirá las opciones y precios. Elegí la que va con tu entrenamiento.",
  },
  {
    n: "02",
    title: "Reservá tu horario",
    body: "Disponibilidad real, en vivo. Reservás en un toque desde el celular.",
  },
  {
    n: "03",
    title: "Pagá y listo",
    body: "Pagás online o por transferencia. Te confirmamos por WhatsApp.",
  },
];

export default async function Home() {
  const services = await getActiveServices();

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        {/* faint brand motif — your real logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.jpg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 top-1/2 hidden h-[340px] w-auto -translate-y-1/2 animate-fade-in opacity-[0.06] lg:block"
        />

        <div className="mx-auto max-w-5xl px-5 py-24 sm:py-32">
          <p className="eyebrow animate-fade-up" style={{ animationDelay: "0ms" }}>
            VULL · Recuperación deportiva
          </p>
          <h1
            className="mt-5 max-w-2xl animate-fade-up text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl"
            style={{ animationDelay: "70ms" }}
          >
            Entrenás al límite.
            <br />
            <span className="text-accent">Recuperá igual.</span>
          </h1>
          <p
            className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-fg-muted"
            style={{ animationDelay: "140ms" }}
          >
            Reservá tu sesión de recuperación, elegí el horario y pagá online. Sin
            llamadas, sin esperas. Coordinamos todo por WhatsApp.
          </p>
          <div
            className="mt-9 flex animate-fade-up flex-wrap items-center gap-3"
            style={{ animationDelay: "210ms" }}
          >
            <Link href="#planes" className="btn-primary px-6 py-3">
              Reservar turno
            </Link>
            <a
              href={waLink("Hola! Quiero hacer una consulta.")}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost px-6 py-3"
            >
              Escribinos
            </a>
          </div>
          <p
            className="mt-8 animate-fade-up font-mono text-xs uppercase tracking-[0.18em] text-fg-faint"
            style={{ animationDelay: "280ms" }}
          >
            Turnos reales · Pago online · Confirmación al toque
          </p>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="mx-auto max-w-5xl px-5 py-20">
        <p className="eyebrow">Cómo funciona</p>
        <div className="mt-8 grid gap-px sm:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="border-t border-border pt-5 sm:pr-6">
              <span className="font-mono text-2xl font-semibold text-accent">
                {s.n}
              </span>
              <h3 className="mt-3 font-semibold text-fg">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Planes */}
      <section id="planes" className="mx-auto max-w-5xl scroll-mt-20 px-5 pb-28">
        <p className="eyebrow">Elegí y reservá</p>
        <h2 className="mt-4 text-3xl font-bold tracking-tight">Planes</h2>

        {services.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-border bg-surface p-10 text-center text-fg-muted">
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
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <div
                key={s.id}
                className="surface-card flex flex-col p-6 transition duration-150 hover:-translate-y-0.5 hover:border-border-strong"
              >
                <h3 className="text-lg font-semibold text-fg">{s.name}</h3>
                {s.description && (
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-fg-muted">
                    {s.description}
                  </p>
                )}
                <div className="mt-5 flex items-center justify-between">
                  <span className="font-mono text-2xl font-semibold text-fg">
                    {formatARS(s.price_ars)}
                  </span>
                  <span className="chip bg-surface-2 font-mono text-fg-muted">
                    {s.duration_minutes} min
                  </span>
                </div>
                <Link
                  href={`/reservar/${s.id}`}
                  className="btn-primary mt-5 w-full"
                >
                  Reservar
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row">
          <Logo withWordmark={false} />
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-fg-faint">
            © {new Date().getFullYear()} {SITE_NAME}
          </span>
          <a
            href={waLink("Hola!")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted transition-colors hover:text-accent"
          >
            WhatsApp
          </a>
        </div>
      </footer>
    </>
  );
}
