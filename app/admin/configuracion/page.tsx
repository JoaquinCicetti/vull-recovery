import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ResourcesEditor, SectorForm } from "./sector-form";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import type { Resource, Sector, SectorHours } from "@/lib/types";

// One card per sector: its agenda, slot grid and policies (what availability
// and create-booking read) and its resources: how many turnos fit in one slot.
export default async function ConfiguracionPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: sectors }, { data: resources }, { data: hours }, { data: monthly }] =
    await Promise.all([
    supabase.from("sectors").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("resources")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("sector_hours").select("sector_id, weekday, opens, closes, slot_minutes"),
    supabase.from("services").select("sector_id").eq("billing", "monthly"),
  ]);
  const monthlySectors = new Set((monthly ?? []).map((s) => s.sector_id as string));

  return (
    <PageShell
      size="wide"
      nav={<AdminTabs />}
      eyebrow="Panel"
      title="Disponibilidad"
      description="Definí, para cada sector, los días y horarios en que se puede reservar, de cuántos minutos es cada turno y cuántos turnos entran a la vez. Cada día puede tener sus propios rangos. Esto controla la disponibilidad que ven los clientes."
    >
      <div className="flex max-w-2xl flex-col gap-6">
        {((sectors ?? []) as Sector[]).map((sector) => (
          <Card
            key={sector.id}
            className="surface-lift animate-fade-up [--card-spacing:--spacing(5)]"
          >
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
                  {sector.name}
                </h2>
                {!sector.active && (
                  <Badge variant="outline" className="font-mono text-xs text-fg-muted">
                    Solo admin
                  </Badge>
                )}
              </div>
              <SectorForm
                sector={sector}
                hours={((hours ?? []) as SectorHours[]).filter((h) => h.sector_id === sector.id)}
                hasMonthly={monthlySectors.has(sector.id)}
              />
              <div className="border-t border-border pt-5">
                <ResourcesEditor
                  sector={sector}
                  resources={((resources ?? []) as Resource[]).filter(
                    (r) => r.sector_id === sector.id,
                  )}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
