import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ResourcesEditor, SectorForm } from "./sector-form";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import type { Resource, Sector } from "@/lib/types";

// One card per sector: its agenda and policies (what availability and
// create-booking read) and, for multi-bed sectors, the beds. Recovery's single
// room isn't shown: there is nothing to decide about it.
export default async function ConfiguracionPage() {
  await requireAdmin();
  const supabase = await createClient();
  const [{ data: sectors }, { data: resources }] = await Promise.all([
    supabase.from("sectors").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("resources")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  return (
    <PageShell
      size="wide"
      nav={<AdminTabs />}
      eyebrow="Panel"
      title="Disponibilidad"
      description="Definí, para cada sector, el horario y los días en que se pueden reservar turnos. Esto controla la disponibilidad que ven los clientes."
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
              <SectorForm sector={sector} />
              {sector.slug !== "recovery" && (
                <div className="border-t border-border pt-5">
                  <ResourcesEditor
                    sector={sector}
                    resources={((resources ?? []) as Resource[]).filter(
                      (r) => r.sector_id === sector.id,
                    )}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
