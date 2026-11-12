import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui/page-shell";
import type { Sector, Service } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PreviewForm } from "./preview-form";

export const metadata: Metadata = { title: "Vista previa de la encuesta" };

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/**
 * What a client sees at /encuesta/<turno>, for an admin to try (ADR 0017): the
 * same form with the chosen plan's stations. Nothing is stored and nobody is
 * notified. Reached from Ajustes › Disponibilidad › Encuestas post-sesión.
 */
export default async function SurveyPreviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const [, sp, sectorsRes, servicesRes] = await Promise.all([
    requireAdmin(),
    searchParams,
    supabase.from("sectors").select("*").order("sort_order", { ascending: true }),
    supabase.from("services").select("*").order("sort_order", { ascending: true }),
  ]);
  const sectors = (sectorsRes.data ?? []) as Sector[];
  const sector = sectors.find((s) => s.slug === one(sp.sector)) ?? sectors.find((s) => s.survey_enabled) ?? sectors[0];
  const plans = ((servicesRes.data ?? []) as Service[]).filter((s) => s.sector_id === sector?.id);
  const plan = plans.find((p) => p.id === one(sp.plan)) ?? plans[0] ?? null;
  const back = sector && sector.id !== sectors[0]?.id ? `/admin/ajustes?sector=${sector.slug}` : "/admin/ajustes";

  return (
    <PageShell
      size="default"
      top="tight"
      nav={
        <Link href={back} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />
          Ajustes
        </Link>
      }
      eyebrow="¡Gracias por venir!"
      title="¿Cómo te fue?"
      description={
        <>
          Tu sesión de <span className="text-fg">{plan?.name ?? "—"}</span>. Son 2 minutos y nos ayudan a seguir
          mejorando nuestros protocolos de recuperación.
        </>
      }
    >
      <div className="mb-6 rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2.5 text-sm text-amber-300">
        <p className="flex items-center gap-2 font-medium">
          <Eye className="size-4 shrink-0" aria-hidden />
          Vista previa: las respuestas no se guardan ni avisan a nadie.
        </p>
        {sector && !sector.survey_enabled && (
          <p className="mt-1 text-amber-300/80">Las encuestas están apagadas para {sector.name}.</p>
        )}
      </div>

      {plans.length > 1 && (
        <nav aria-label="Plan" className="mb-6">
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-fg-faint">
            Ver con las estaciones de
          </p>
          <div className="flex flex-wrap gap-2">
            {plans.map((p) => (
              <Link
                key={p.id}
                href={`/admin/ajustes/encuesta?sector=${sector!.slug}&plan=${p.id}`}
                aria-current={p.id === plan?.id ? "true" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm transition-colors",
                  p.id === plan?.id
                    ? "border-accent bg-accent/10 font-semibold text-fg"
                    : "border-border text-fg-muted hover:text-fg",
                )}
              >
                {p.name}
                <span className="ml-1.5 font-mono text-xs text-fg-faint">{(p.stations ?? []).length}</span>
              </Link>
            ))}
          </div>
        </nav>
      )}

      {plan ? (
        <PreviewForm planId={plan.id} stations={plan.stations ?? []} />
      ) : (
        <p className="text-sm text-fg-faint">Este sector no tiene planes.</p>
      )}
    </PageShell>
  );
}
