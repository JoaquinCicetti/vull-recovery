import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyCredits } from "@/lib/credits";
import { isActiveStatus } from "@/lib/booking-status";
import { AccountTabs } from "@/components/account/account-tabs";
import type { AccountBooking } from "@/components/account/booking-row";
import { TurnosView } from "@/components/account/turnos-view";
import { PageShell } from "@/components/ui/page-shell";
import type { BookingStatus } from "@/lib/types";

type Row = {
  id: string;
  starts_at: string;
  status: BookingStatus;
  hold_expires_at: string | null;
  services: { name: string } | null;
};

export default async function MisTurnosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireUser("/mis-turnos");
  const showAll = (await searchParams).historial === "todo";

  const supabase = await createClient();
  const [{ data }, credits] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, starts_at, status, hold_expires_at, services(name)")
      // Explicit: RLS lets an admin read EVERY booking, and this page is "mine".
      .eq("user_id", user!.id)
      .order("starts_at", { ascending: true }),
    getMyCredits(),
  ]);

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const now = Date.now();
  const nowISO = new Date(now).toISOString();

  const all: AccountBooking[] = ((data ?? []) as unknown as Row[]).map((b) => ({
    id: b.id,
    startsAt: b.starts_at,
    status: b.status,
    service: b.services?.name ?? "Servicio",
    holdExpiresAt: b.hold_expires_at,
  }));

  // Upcoming = still holds a slot and has not started. Everything else (past,
  // cancelled, expired) is history, newest first.
  const upcoming = all.filter(
    (b) => isActiveStatus(b.status) && new Date(b.startsAt).getTime() >= now,
  );
  const history = all.filter((b) => !upcoming.includes(b)).reverse();
  const totalCredits = credits.reduce((n, c) => n + c.remaining, 0);

  return (
    <PageShell nav={<AccountTabs />} eyebrow="Tu cuenta" title="Mis turnos">
      <TurnosView
        upcoming={upcoming}
        history={history}
        showAll={showAll}
        totalCredits={totalCredits}
        creditServiceId={credits[0]?.serviceId ?? null}
        nowISO={nowISO}
      />
    </PageShell>
  );
}
