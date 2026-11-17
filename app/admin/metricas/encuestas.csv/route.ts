import { getUserAndProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, localDate } from "@/lib/format";
import { LEVEL_LABEL, REVIEW_LABEL, YES_LABEL, type Level, type ReviewStatus, type YesSome } from "@/lib/survey";

// Every answered survey of a sector as a spreadsheet (ADR 0018). Same filters as
// the list in Métricas › Encuestas: ?sector=<id>&dias=<n>&opiniones=<filtro>.
// Read with the admin's own session, so RLS is what guards the data; the check
// below only turns "no rows" into a clear 403.

const REVIEW: Record<string, ReviewStatus> = { pendientes: "pending", publicadas: "approved", ocultas: "hidden" };
const CHUNK = 1000; // PostgREST's row cap per request

type Row = {
  submitted_at: string;
  sent_at: string | null;
  age: number | null;
  sport: string | null;
  level: Level | null;
  training_days: number | null;
  pre_fatigue: number | null;
  pre_soreness: number | null;
  pre_tiredness: number | null;
  pre_recovery: number | null;
  pre_sleep: number | null;
  post_overall: number | null;
  tension_relief: YesSome | null;
  mobility_gain: YesSome | null;
  best_stations: string[] | null;
  best_station_other: string | null;
  experience: number | null;
  valued: string | null;
  improve: string | null;
  nps: number | null;
  rating: number | null;
  public_comment: string | null;
  review_status: ReviewStatus | null;
  services: { name: string } | null;
  bookings: { starts_at: string } | null;
  profiles: { full_name: string | null; email: string | null; whatsapp_phone: string | null } | null;
};

const COLUMNS: [string, (r: Row) => string | number | null | undefined][] = [
  ["Respondida", (r) => fmtDateTime(r.submitted_at)],
  ["Sesión", (r) => (r.bookings ? fmtDateTime(r.bookings.starts_at) : "")],
  ["Plan", (r) => r.services?.name],
  ["Cliente", (r) => r.profiles?.full_name],
  ["Email", (r) => r.profiles?.email],
  ["WhatsApp", (r) => r.profiles?.whatsapp_phone],
  ["Enviada por WhatsApp", (r) => (r.sent_at ? "Sí" : "No")],
  ["Edad", (r) => r.age],
  ["Deporte", (r) => r.sport],
  ["Nivel", (r) => (r.level ? LEVEL_LABEL[r.level] : "")],
  ["Días de entrenamiento por semana", (r) => r.training_days],
  ["Antes: fatiga muscular (0-10)", (r) => r.pre_fatigue],
  ["Antes: dolor muscular (0-10)", (r) => r.pre_soreness],
  ["Antes: cansancio general (0-10)", (r) => r.pre_tiredness],
  ["Antes: sensación de recuperación (0-10)", (r) => r.pre_recovery],
  ["Antes: calidad del sueño (0-10)", (r) => r.pre_sleep],
  ["Después: estado físico general (0-10)", (r) => r.post_overall],
  ["Menos tensión muscular", (r) => (r.tension_relief ? YES_LABEL[r.tension_relief] : "")],
  ["Más movilidad", (r) => (r.mobility_gain ? YES_LABEL[r.mobility_gain] : "")],
  ["Lo más beneficioso", (r) => (r.best_stations ?? []).join(", ")],
  ["Lo más beneficioso (otra)", (r) => r.best_station_other],
  ["Experiencia general (0-10)", (r) => r.experience],
  ["Lo que más valoró", (r) => r.valued],
  ["Qué mejoraría", (r) => r.improve],
  ["Recomendaría VULL (0-10)", (r) => r.nps],
  ["Estrellas (1-5)", (r) => r.rating],
  ["Comentario público", (r) => r.public_comment],
  ["Estado del comentario", (r) => (r.review_status ? REVIEW_LABEL[r.review_status] : "")],
];

// Quoted always. Text a client typed must never run as a formula in Excel, so a
// cell that starts like one gets a leading apostrophe.
function cell(v: string | number | null | undefined) {
  if (v == null) return '""';
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const { user, profile } = await getUserAndProfile();
  if (!user) return new Response("No autenticado", { status: 401 });
  if (!profile?.is_admin) return new Response("No autorizado", { status: 403 });

  const sp = new URL(request.url).searchParams;
  const sector = sp.get("sector");
  if (!sector || !/^[0-9a-f-]{36}$/i.test(sector)) return new Response("Falta el sector", { status: 400 });
  const days = Math.min(3650, Math.max(1, Number.parseInt(sp.get("dias") ?? "", 10) || 30));
  const review = REVIEW[sp.get("opiniones") ?? ""] ?? null;
  const pendingOnly = review === "pending";

  const now = Date.now();
  const from = localDate(new Date(now - (days - 1) * 86_400_000).toISOString());

  const supabase = await createClient();
  const rows: Row[] = [];
  for (let offset = 0; ; offset += CHUNK) {
    let q = supabase
      .from("session_surveys")
      .select(
        "submitted_at, sent_at, age, sport, level, training_days, pre_fatigue, pre_soreness, pre_tiredness, pre_recovery, pre_sleep, post_overall, tension_relief, mobility_gain, best_stations, best_station_other, experience, valued, improve, nps, rating, public_comment, review_status, services(name), bookings(starts_at), profiles(full_name, email, whatsapp_phone)",
      )
      .eq("sector_id", sector)
      .not("submitted_at", "is", null);
    // Same rule as the list: the approval queue ignores the period.
    if (!pendingOnly) q = q.gte("submitted_at", `${from}T00:00:00-03:00`);
    if (review) q = q.eq("review_status", review);
    const { data, error } = await q
      .order("submitted_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (error) return new Response(`No pudimos exportar: ${error.message}`, { status: 500 });
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < CHUNK) break;
  }

  // ";" and a BOM: what Excel in es-AR opens straight into columns, accents intact.
  const lines = [
    COLUMNS.map(([h]) => cell(h)).join(";"),
    ...rows.map((r) => COLUMNS.map(([, get]) => cell(get(r))).join(";")),
  ];
  const name = `encuestas-vull-${localDate(new Date(now).toISOString())}.csv`;
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
