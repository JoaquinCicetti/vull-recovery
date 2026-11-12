import type { Metadata } from "next";
import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime } from "@/lib/format";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import type { Level, SurveyAnswers } from "@/lib/survey";
import { SurveyForm, ThankYou } from "./survey-form";

export const metadata: Metadata = { title: "Encuesta" };

type BookingRow = {
  id: string;
  user_id: string | null;
  starts_at: string;
  status: string;
  services: { name: string; stations: string[] | null } | null;
  sectors: { survey_enabled: boolean; timezone: string } | null;
};

type Prev = { age: number | null; sport: string | null; level: Level | null; training_days: number | null };

/**
 * The post-session survey (ADR 0017). Reached from the WhatsApp link an admin
 * sends, or from Mis turnos. submit_session_survey re-checks everything here.
 */
export default async function EncuestaPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const user = await requireSession(`/encuesta/${bookingId}`);
  const supabase = await createClient();

  const uuid = /^[0-9a-f-]{36}$/i.test(bookingId);
  const [{ data: booking }, { data: survey }, { data: prev }] = uuid
    ? await Promise.all([
        supabase
          .from("bookings")
          .select("id, user_id, starts_at, status, services(name, stations), sectors(survey_enabled, timezone)")
          .eq("id", bookingId)
          .eq("user_id", user.id)
          .maybeSingle<BookingRow>(),
        supabase.from("session_surveys").select("submitted_at").eq("booking_id", bookingId).maybeSingle(),
        supabase
          .from("session_surveys")
          .select("age, sport, level, training_days")
          .eq("user_id", user.id)
          .not("submitted_at", "is", null)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle<Prev>(),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  // eslint-disable-next-line react-hooks/purity -- server component: renders once
  const now = Date.now();
  const eligible =
    booking &&
    booking.status === "confirmed" &&
    booking.sectors?.survey_enabled &&
    new Date(booking.starts_at).getTime() <= now;

  if (!eligible) {
    return (
      <PageShell size="default" top="tight" eyebrow="Encuesta" title="Esta encuesta no está disponible">
        <p className="text-sm text-fg-muted">
          El link no corresponde a una sesión tuya que ya hayas hecho. Si creés que es un error, escribinos.
        </p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/mis-turnos">Ir a mis turnos</Link>
        </Button>
      </PageShell>
    );
  }

  const when = fmtDateTime(booking.starts_at, booking.sectors?.timezone);
  const service = booking.services?.name ?? "Sesión";

  if (survey?.submitted_at) {
    return (
      <PageShell size="default" top="tight" eyebrow="Encuesta" title={service}>
        <ThankYou again />
      </PageShell>
    );
  }

  const prefill: Partial<SurveyAnswers> = prev
    ? { age: prev.age, sport: prev.sport ?? "", level: prev.level, training_days: prev.training_days }
    : {};

  return (
    <PageShell
      size="default"
      top="tight"
      eyebrow="¡Gracias por venir!"
      title="¿Cómo te fue?"
      description={
        <>
          Tu sesión de <span className="text-fg">{service}</span> del{" "}
          <span className="font-mono tabular-nums text-fg">{when}</span>. Son 2 minutos y nos ayudan a seguir mejorando
          nuestros protocolos de recuperación.
        </>
      }
    >
      <SurveyForm bookingId={booking.id} stations={booking.services?.stations ?? []} prefill={prefill} />
    </PageShell>
  );
}
