"use client";

import { useEffect, useState } from "react";
import { MEMBERSHIP_ACTIVE } from "@/lib/booking-status";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { formatARS, waLink } from "@/lib/site";
import { isMonthly, isPack, type Sector, type Service } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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

// `initialServices` is the build-time snapshot the static page ships with; the
// live list (an admin may have changed prices since the deploy) and the signed-in
// user's credit balances are fetched here in the browser, which is what lets the
// pages that render this stay static.
//
// `balances` maps service id -> live credits the signed-in user holds for it
// (empty when signed out). The call to action follows the BALANCE, not the shape
// of the plan: holding credits means the next step is booking, not buying again.
//
// Plans are grouped by sector. RLS only returns the plans of active sectors to
// the public (and the static snapshot is fetched as anon), so a visitor sees one
// group without a heading, exactly as before sectors existed; an admin also gets
// the hidden sectors' plans, under a heading marked "Solo admin".
export function Plans({ initialServices }: { initialServices: Service[] }) {
  const [services, setServices] = useState(initialServices);
  const [sectors, setSectors] = useState<Pick<Sector, "id" | "name" | "active">[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  // Monthly plans the signed-in user already has a live abono of.
  const [members, setMembers] = useState<Set<string>>(new Set());

  useEffect(() => {
    const supabase = createClient();
    let alive = true;
    supabase
      .from("services")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (alive && data) setServices(data as Service[]);
      });
    supabase
      .from("sectors")
      .select("id, name, active")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        if (alive && data) setSectors(data);
      });
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase.rpc("my_credit_balances");
      const out: Record<string, number> = {};
      for (const row of (data ?? []) as { service_id: string; balance: number }[]) {
        out[row.service_id] = row.balance;
      }
      if (alive) setBalances(out);
      const { data: mine } = await supabase
        .from("memberships")
        .select("service_id")
        .eq("user_id", session.user.id)
        .in("status", MEMBERSHIP_ACTIVE);
      if (alive) setMembers(new Set((mine ?? []).map((m) => m.service_id as string)));
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      id="planes"
      className="relative scroll-mt-16 border-t border-border px-5 py-24 sm:py-32"
    >
      <div className="relative mx-auto max-w-6xl">
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
          <div className="mt-12 flex flex-col gap-14">
            {groupBySector(services, sectors).map((g) => (
              <div key={g.key}>
                {g.heading && (
                  <div className="mb-5 flex items-center gap-3">
                    <h3 className="text-2xl font-bold tracking-tight">{g.heading}</h3>
                    {g.hidden && (
                      <Badge variant="outline" className="font-mono text-xs text-fg-muted">
                        Solo admin
                      </Badge>
                    )}
                  </div>
                )}
                <motion.div
                  variants={grid}
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, margin: "-10%" }}
                  className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {g.services.map((s) => (
                    <PlanCard
                      key={s.id}
                      service={s}
                      credits={balances[s.id] ?? 0}
                      member={members.has(s.id)}
                    />
                  ))}
                </motion.div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type PlanGroup = { key: string; heading: string | null; hidden: boolean; services: Service[] };

// Sector order, then each plan's own order. One group → no heading.
function groupBySector(
  services: Service[],
  sectors: Pick<Sector, "id" | "name" | "active">[],
): PlanGroup[] {
  const groups: PlanGroup[] = [];
  for (const sector of sectors) {
    const own = services.filter((s) => s.sector_id === sector.id);
    if (own.length) {
      groups.push({ key: sector.id, heading: sector.name, hidden: !sector.active, services: own });
    }
  }
  // Plans whose sector isn't loaded yet (the static snapshot, before hydration).
  const known = new Set(sectors.map((s) => s.id));
  const rest = services.filter((s) => !known.has(s.sector_id));
  if (rest.length) groups.push({ key: "rest", heading: null, hidden: false, services: rest });
  if (groups.length === 1) groups[0].heading = null;
  return groups;
}

function PlanCard({
  service: s,
  credits,
  member,
}: {
  service: Service;
  credits: number;
  member: boolean;
}) {
  const monthly = isMonthly(s);
  const perWeek = s.classes_per_week ?? 1;
  return (
    <motion.div variants={card} className="h-full">
      <Card className="surface-lift group relative flex h-full flex-col rounded-2xl ring-0 transition-all duration-300 [--card-spacing:--spacing(6)] hover:-translate-y-1.5 hover:border-accent/50 hover:shadow-[0_28px_70px_-28px_rgba(97,179,59,0.65)] has-data-[slot=card-footer]:pb-(--card-spacing)">
        {/* hover glow */}
        <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-accent/15 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
        <CardHeader className="relative gap-0">
          <CardTitle className="text-xl font-semibold text-fg">
            {s.name}
          </CardTitle>
          {s.description && (
            <CardDescription className="mt-2 leading-relaxed text-fg-muted">
              {s.description}
            </CardDescription>
          )}
          {monthly && (
            <p className="mt-2 text-sm text-fg-faint">
              Horario fijo cada semana. Podés reservar tu lugar todos los meses.
            </p>
          )}
        </CardHeader>
        <CardContent className="relative mt-auto flex items-end justify-between">
          {/* Already paid for: show what's left, not what it costs. */}
          <span className="font-mono text-3xl font-semibold tracking-tight text-fg">
            {monthly && member ? (
              <span className="text-accent">Tu plan</span>
            ) : monthly ? (
              <>
                {formatARS(s.price_ars)}
                <span className="text-base font-medium text-fg-muted"> / mes</span>
              </>
            ) : credits > 0 ? (
              <span className="text-accent">
                {credits}{" "}
                <span className="text-base font-medium">
                  {credits === 1 ? "sesión" : "sesiones"}
                </span>
              </span>
            ) : (
              formatARS(s.price_ars)
            )}
          </span>
          <Badge
            variant="secondary"
            className="h-auto rounded-md px-2.5 py-1 font-mono font-medium text-fg-muted"
          >
            {monthly
              ? `${perWeek} ${perWeek === 1 ? "clase" : "clases"} por semana`
              : isPack(s)
                ? `${s.sessions_included} sesiones`
                : `${s.duration_minutes} min`}
          </Badge>
        </CardContent>
        <CardFooter className="relative border-t-0 bg-transparent p-0 px-(--card-spacing)">
          <Button asChild size="lg" className="w-full">
            {monthly ? (
              member ? (
                <Link href="/cuenta/plan">Ver mi plan</Link>
              ) : (
                <Link href={`/abono/${s.id}`}>Elegir mis horarios</Link>
              )
            ) : isPack(s) && credits === 0 ? (
              <Link href={`/comprar/${s.id}`}>Comprar pack</Link>
            ) : (
              <Link href={`/reservar/${s.id}`}>Reservar</Link>
            )}
          </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
