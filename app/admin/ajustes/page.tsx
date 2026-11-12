import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SectorSettings } from "./sector-form";
import { ServicesManager } from "./services-manager";
import { AdminNotices } from "./admin-notices";
import { CouponsManager, type CouponRow } from "./coupons-manager";
import { LoadErrors } from "@/components/admin/load-errors";
import { Segmented } from "@/components/admin/segmented";
import { Badge } from "@/components/ui/badge";
import { PageShell } from "@/components/ui/page-shell";
import type { Resource, Sector, SectorHours, Service } from "@/lib/types";
import type { FailedNotification } from "@/components/admin/failed-notifications";

export const metadata: Metadata = { title: "Ajustes" };

/* eslint-disable @typescript-eslint/no-explicit-any */

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

// How the business is set up, one sector at a time: its plans and prices, its
// agenda (days, hours, slot length, places) and its policies. Below, what is
// not per sector: discount codes and the admin's own alerts.
export default async function AjustesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const loadErrors: string[] = [];

  // The admin check (one profile read) and the six reads go out together:
  // this page is one round trip to the database.
  const [, sp, sectorsRes, resourcesRes, hoursRes, servicesRes, notifRes, couponsRes] = await Promise.all([
    requireAdmin(),
    searchParams,
    supabase.from("sectors").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("resources")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase.from("sector_hours").select("sector_id, weekday, opens, closes, slot_minutes"),
    supabase.from("services").select("*").order("sort_order", { ascending: true }),
    // Notices the dispatcher could not deliver (ADR 0013): a failed row keeps
    // `error` until it goes out.
    supabase
      .from("notifications")
      .select("id, kind, audience, created_at, error, attempts")
      .is("sent_at", null)
      .not("error", "is", null)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.rpc("admin_coupons"),
  ]);
  for (const [label, res] of [
    ["Sectores", sectorsRes],
    ["Lugares", resourcesRes],
    ["Horarios", hoursRes],
    ["Planes", servicesRes],
    ["Avisos", notifRes],
    ["Cupones", couponsRes],
  ] as const) {
    if (res.error) loadErrors.push(`${label}: ${res.error.message}`);
  }

  const sectors = (sectorsRes.data ?? []) as Sector[];
  const sector = sectors.find((s) => s.slug === one(sp.sector)) ?? sectors[0] ?? null;
  const services = (servicesRes.data ?? []) as Service[];
  const failed: FailedNotification[] = ((notifRes.data ?? []) as any[]).map((n) => ({
    id: n.id,
    kind: n.kind,
    audience: n.audience,
    createdAt: n.created_at,
    error: n.error,
    attempts: n.attempts,
  }));

  return (
    <PageShell size="wide" top="tight" eyebrow="Panel" title="Ajustes">
      <LoadErrors errors={loadErrors} />

      {sectors.length > 1 && (
        <div className="mb-6">
          <Segmented
            prominent
            label="Sector"
            items={sectors.map((s) => ({
              href: s.id === sectors[0]?.id ? "/admin/ajustes" : `/admin/ajustes?sector=${s.slug}`,
              label: s.active ? s.name : `${s.name} (oculto)`,
              active: s.id === sector?.id,
            }))}
          />
        </div>
      )}

      {sector && (
        <div className="flex flex-col gap-10">
          {!sector.active && (
            <Badge variant="outline" className="w-fit font-mono text-xs text-fg-muted">
              {sector.name}: solo admin (oculto en la web)
            </Badge>
          )}
          <ServicesManager
            key={`svc-${sector.id}`}
            initial={services.filter((s) => s.sector_id === sector.id)}
            sector={sector}
          />
          <SectorSettings
            key={`sec-${sector.id}`}
            sector={sector}
            hours={((hoursRes.data ?? []) as SectorHours[]).filter((h) => h.sector_id === sector.id)}
            resources={((resourcesRes.data ?? []) as Resource[]).filter((r) => r.sector_id === sector.id)}
            hasMonthly={services.some((s) => s.sector_id === sector.id && s.billing === "monthly")}
          />
        </div>
      )}

      <div className="mt-10 flex flex-col gap-10">
        <CouponsManager initial={(couponsRes.data ?? []) as CouponRow[]} />
        <AdminNotices failed={failed} />
      </div>
    </PageShell>
  );
}
