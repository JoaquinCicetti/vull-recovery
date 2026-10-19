import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  SesionesView,
  type SessionBalance,
  type SessionMovement,
} from "@/components/account/sesiones-view";
import { PageShell } from "@/components/ui/page-shell";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function SesionesPage() {
  const { user } = await requireUser("/cuenta/sesiones");
  const supabase = await createClient();

  // Both tables are readable own-row through RLS. The user filter is explicit
  // because an admin's RLS returns everyone's rows.
  const [creditsRes, ledgerRes] = await Promise.all([
    supabase
      .from("user_credits")
      .select("service_id, remaining, expires_at, services(name, active)")
      .eq("user_id", user!.id),
    supabase
      .from("credit_ledger")
      .select("id, delta, reason, note, created_at, services(name)")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const now = Date.now();
  const balances: SessionBalance[] = ((creditsRes.data ?? []) as any[])
    .map((c) => {
      const expiresMs = c.expires_at ? new Date(c.expires_at).getTime() : null;
      const expired = expiresMs != null && expiresMs <= now;
      return {
        serviceId: c.service_id as string,
        name: (c.services?.name as string) ?? "Plan",
        bookable: Boolean(c.services?.active),
        remaining: c.remaining as number,
        expiresAt: (c.expires_at as string) ?? null,
        expired,
        daysLeft: expiresMs != null ? Math.ceil((expiresMs - now) / 86400000) : null,
      };
    })
    // A spent, never-expiring row is just noise.
    .filter((c) => c.remaining > 0);

  const movements: SessionMovement[] = ((ledgerRes.data ?? []) as any[]).map((m) => ({
    id: m.id,
    delta: m.delta,
    reason: m.reason,
    service: m.services?.name ?? "Plan",
    createdAt: m.created_at,
  }));

  return (
    <PageShell size="wide" top="tight" eyebrow="Tu cuenta" title="Sesiones">
      <SesionesView balances={balances} movements={movements} />
    </PageShell>
  );
}
