// Monthly plans ("abonos"): what the membership edge functions share.
//
// The rules live in SQL (supabase/migrations/20261015150000_memberships.sql and
// 20261015160000_swap_requests.sql). Those functions raise either a business
// token (P0001, message = token) or a constraint code with the colliding
// occurrence as JSON detail; this file is the ONE place that turns them into an
// HTTP status and the Spanish sentence the client reads.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const WEEKDAY_LONG = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export type SlotInput = { weekday: number; start_time: string; resource_id: string };

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Shape-check the client's weekly pattern; the database re-checks the rules. */
export function parseSlots(raw: unknown): SlotInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 7) return null;
  const out: SlotInput[] = [];
  for (const s of raw) {
    const weekday = Number(s?.weekday);
    const start = String(s?.start_time ?? "").slice(0, 5);
    const resource = String(s?.resource_id ?? "");
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
    if (!HM.test(start) || !UUID.test(resource)) return null;
    out.push({ weekday, start_time: start, resource_id: resource });
  }
  return out;
}

export function parseDate(raw: unknown): string | null {
  return typeof raw === "string" && YMD.test(raw) ? raw : null;
}

const dd = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(d)}/${Number(m)}`;
};

type PgError = { code?: string; message?: string; details?: string | null };

function detail(e: PgError): Record<string, unknown> {
  try {
    return e.details ? JSON.parse(e.details) : {};
  } catch {
    return {};
  }
}

export type Mapped = { status: number; error: string };

/** A database error from a membership/swap function → status + message. */
export function mapDbError(
  e: PgError,
  ctx: { classesPerWeek?: number | null; noticeHours?: number } = {},
): Mapped {
  const d = detail(e);
  if (e.code === "23P01") {
    if (d.on_date && d.resource_name && d.weekday !== undefined) {
      return {
        status: 409,
        error: `La ${d.resource_name} del ${WEEKDAY_LONG[Number(d.weekday)]} ${d.start_time} ya está tomada el ${
          dd(String(d.on_date))
        }. Elegí otra cama u otro horario.`,
      };
    }
    return { status: 409, error: "Ese horario ya fue reservado. Elegí otro." };
  }
  if (e.code === "23505") {
    if (d.side === "a") return { status: 409, error: "Ya tenés clase ese día." };
    if (d.side === "b") return { status: 409, error: "La otra persona ya tiene clase ese día." };
    if (d.on_date) {
      return {
        status: 409,
        error: `Ya tenés un turno el ${dd(String(d.on_date))}. Cancelalo o elegí otro día.`,
      };
    }
    return { status: 409, error: "Ya tenés un turno ese día." };
  }
  const n = ctx.classesPerWeek;
  const h = ctx.noticeHours ?? 24;
  const byToken: Record<string, Mapped> = {
    not_monthly: { status: 404, error: "Plan no disponible" },
    slot_count_mismatch: {
      status: 400,
      error: n ? `Elegí ${n} ${n === 1 ? "día" : "días"} con su horario.` : "Elegí tus horarios.",
    },
    duplicate_weekday: { status: 400, error: "No podés tener dos clases el mismo día." },
    bad_resource: { status: 400, error: "Esa cama no está disponible." },
    outside_hours: { status: 409, error: "Ese horario está fuera del horario de atención." },
    bad_start: { status: 400, error: "Fecha de inicio inválida." },
    no_classes: {
      status: 409,
      error: "No quedan clases de ese horario este mes. Elegí otro o empezá el mes que viene.",
    },
    already_member: { status: 409, error: "Ya tenés un abono en este sector." },
    not_active: { status: 409, error: "El abono ya no está activo." },
    not_pending: { status: 409, error: "Ese abono ya está pago." },
    not_owner: { status: 403, error: "No autorizado" },
    not_found: { status: 404, error: "No encontramos esa clase." },
    not_confirmed: { status: 409, error: "Solo se pueden cambiar clases confirmadas." },
    different_sector: { status: 400, error: "Datos inválidos" },
    same_user: { status: 400, error: "Esa clase ya es tuya." },
    too_late: { status: 409, error: `Los cambios se hacen con al menos ${h} horas de anticipación.` },
    different_week: {
      status: 409,
      error: "Solo podés cambiar por una clase de la misma semana y del mismo mes.",
    },
    pending_exists: {
      status: 409,
      error: "Ya propusiste un cambio para esa clase. Esperá la respuesta o cancelalo.",
    },
    request_closed: { status: 409, error: "Esa propuesta ya no está abierta." },
    bad_action: { status: 400, error: "Acción inválida" },
  };
  return byToken[e.message ?? ""] ?? { status: 500, error: "No se pudo completar la operación." };
}

/** "lunes 10:00 · Cama 2, miércoles 10:00 · Cama 2" for emails and alerts. */
export function scheduleRows(
  slots: { weekday: number; start_time: string; resources?: { name: string } | null }[],
) {
  return [...slots]
    .sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday))
    .map((s) => ({
      label: WEEKDAY_LONG[s.weekday][0].toUpperCase() + WEEKDAY_LONG[s.weekday].slice(1),
      value: `${s.start_time.slice(0, 5)} · ${s.resources?.name ?? "Cama"}`,
      mono: true,
    }));
}

export type MembershipCtx = {
  id: string;
  userId: string;
  status: string;
  locked: boolean;
  startsOn: string;
  endsOn: string | null;
  serviceId: string;
  plan: string;
  priceArs: number;
  classesPerWeek: number;
  sector: {
    id: string;
    name: string;
    timezone: string;
    due_day: number;
    late_fee_pct: number;
    release_day: number;
    hold_minutes: number;
    change_notice_hours: number;
    lead_minutes: number;
  };
  slots: { weekday: number; start_time: string; resource_id: string; resources: { name: string } | null }[];
};

export async function loadMembership(
  admin: SupabaseClient,
  membershipId: string,
): Promise<MembershipCtx | null> {
  const { data } = await admin
    .from("memberships")
    .select(
      "id, user_id, status, locked, starts_on, ends_on, service_id, services(name, price_ars, classes_per_week), sectors(id, name, timezone, due_day, late_fee_pct, release_day, hold_minutes, change_notice_hours, lead_minutes), membership_slots(weekday, start_time, resource_id, resources(name))",
    )
    .eq("id", membershipId)
    .maybeSingle();
  if (!data) return null;
  // deno-lint-ignore no-explicit-any
  const m = data as any;
  return {
    id: m.id,
    userId: m.user_id,
    status: m.status,
    locked: m.locked,
    startsOn: m.starts_on,
    endsOn: m.ends_on,
    serviceId: m.service_id,
    plan: m.services?.name ?? "Abono",
    priceArs: m.services?.price_ars ?? 0,
    classesPerWeek: m.services?.classes_per_week ?? 0,
    sector: m.sectors,
    slots: m.membership_slots ?? [],
  };
}

/** Run the lazy maintenance (hold sweep, membership expiry, roll, stale swap
 *  offers). Best-effort: a failure here must not fail the caller's request. */
export async function housekeeping(admin: SupabaseClient): Promise<void> {
  try {
    await admin.rpc("housekeeping");
  } catch (_) {
    /* best-effort */
  }
}

/** Expire every live Talo CVU of a cuota (cancelled/released abono). */
export async function killLivePeriodPayments(
  admin: SupabaseClient,
  periodIds: string[],
  setTaloExpiration: (id: string, iso: string) => Promise<unknown>,
): Promise<void> {
  if (periodIds.length === 0) return;
  const { data } = await admin
    .from("payments")
    .select("id, talo_payment_id")
    .in("membership_period_id", periodIds)
    .eq("provider", "talo")
    .eq("status", "pending");
  const soon = new Date(Date.now() + 60_000).toISOString();
  for (const r of (data ?? []) as { id: string; talo_payment_id: string | null }[]) {
    if (r.talo_payment_id) await setTaloExpiration(r.talo_payment_id, soon).catch(() => {});
    await admin.from("payments").update({ status: "rejected" }).eq("id", r.id).eq("status", "pending");
  }
}
