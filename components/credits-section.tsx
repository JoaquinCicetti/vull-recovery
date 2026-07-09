import Link from "next/link";
import type { Credit } from "@/lib/credits";

// The user's live credit balances, each linking to the booking page that spends
// them. Shown on /mis-turnos and /cuenta. Renders nothing when there is no balance.
export function CreditsSection({ credits }: { credits: Credit[] }) {
  if (credits.length === 0) return null;

  return (
    <section className="mb-10">
      <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
        Mis créditos
      </h2>
      <ul className="mt-3 flex flex-col gap-3">
        {credits.map(({ serviceId, name, remaining }) => (
          <li
            key={serviceId}
            className="surface-card flex items-center justify-between gap-4 p-5"
          >
            <p className="font-semibold text-fg">{name}</p>
            <div className="flex items-center gap-4">
              <span className="font-mono text-accent">
                {remaining} {remaining === 1 ? "sesión" : "sesiones"}
              </span>
              <Link
                href={`/reservar/${serviceId}`}
                className="shrink-0 font-mono text-xs uppercase tracking-[0.14em] text-fg-muted underline underline-offset-4 transition-colors hover:text-fg"
              >
                Reservar
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-fg-faint">
        Usás un crédito al reservar cada turno.
      </p>
    </section>
  );
}
