"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CalendarClock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { fmtTime, localDate } from "@/lib/format";
import { dateLabel } from "@/lib/membership";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type FreeSlot = {
  starts_at: string;
  ends_at: string;
  free_resources: { id: string; name: string }[];
};
type Day = { date: string; slots: FreeSlot[] };
type Candidate = {
  booking_id: string;
  starts_at: string;
  resource_name: string;
  client_label: string;
};

// Monday (YYYY-MM-DD) of the week a local date falls in, and its month.
function weekKey(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return { week: t - dow * 86400000, month: date.slice(0, 7) };
}

// What a member can do with one class of their abono: move it to a free slot
// or offer it to another member in exchange for theirs. Both only for the same
// week and month, and only until `noticeHours` before (the server re-checks).
export function ClassActions({
  bookingId,
  serviceId,
  startsAt,
  resourceId,
  timezone,
  noticeHours,
  changeable,
  outgoingRequestId,
  busyDays = [],
}: {
  bookingId: string;
  serviceId: string;
  startsAt: string;
  resourceId: string;
  timezone: string;
  noticeHours: number;
  changeable: boolean;
  outgoingRequestId: string | null;
  /** Local dates the member already has another class on. */
  busyDays?: string[];
}) {
  const [open, setOpen] = useState<"move" | "swap" | null>(null);

  if (!changeable) {
    return (
      <div className="surface-card mt-6 p-5">
        <div className="flex gap-2">
          <Button variant="outline" disabled className="flex-1">
            <CalendarClock className="size-4" aria-hidden /> Mover
          </Button>
          <Button variant="outline" disabled className="flex-1">
            <ArrowLeftRight className="size-4" aria-hidden /> Intercambiar
          </Button>
        </div>
        <p className="mt-2.5 text-xs text-fg-faint">
          Faltan menos de {noticeHours} h: esta clase ya no se puede mover ni intercambiar.
        </p>
      </div>
    );
  }

  return (
    <div className="surface-card mt-6 p-5">
      <p className="eyebrow">¿No podés ir?</p>
      <p className="mt-1.5 text-sm text-fg-muted">
        Movela a un horario libre o cambiala con otra persona del abono, dentro de la misma
        semana, hasta {noticeHours} h antes.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant={open === "move" ? "default" : "outline"}
          className="flex-1"
          aria-expanded={open === "move"}
          onClick={() => setOpen(open === "move" ? null : "move")}
        >
          <CalendarClock className="size-4" aria-hidden /> Mover
        </Button>
        <Button
          variant={open === "swap" ? "default" : "outline"}
          className="flex-1"
          aria-expanded={open === "swap"}
          onClick={() => setOpen(open === "swap" ? null : "swap")}
        >
          <ArrowLeftRight className="size-4" aria-hidden /> Intercambiar
        </Button>
      </div>
      {open === "move" && (
        <MovePanel
          bookingId={bookingId}
          serviceId={serviceId}
          startsAt={startsAt}
          resourceId={resourceId}
          timezone={timezone}
          noticeHours={noticeHours}
          busyDays={busyDays}
        />
      )}
      {open === "swap" && (
        <SwapPanel bookingId={bookingId} timezone={timezone} outgoingRequestId={outgoingRequestId} />
      )}
    </div>
  );
}

function MovePanel({
  bookingId,
  serviceId,
  startsAt,
  resourceId,
  timezone,
  noticeHours,
  busyDays,
}: {
  bookingId: string;
  serviceId: string;
  startsAt: string;
  resourceId: string;
  timezone: string;
  noticeHours: number;
  busyDays: string[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [days, setDays] = useState<Day[] | null>(null);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<FreeSlot | null>(null);
  const [bed, setBed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const own = weekKey(localDate(startsAt, timezone));
    const cutoff = Date.now() + noticeHours * 3600_000;
    supabase.functions
      .invoke("availability", { body: { service_id: serviceId } })
      .then(async ({ data, error: err }) => {
        if (!live) return;
        if (err) {
          setError(await readError(err, "No pudimos cargar los horarios."));
          setDays([]);
          return;
        }
        const out = ((data?.days ?? []) as Day[])
          .filter((d) => {
            const k = weekKey(d.date);
            return k.week === own.week && k.month === own.month && !busyDays.includes(d.date);
          })
          .map((d) => ({
            ...d,
            slots: d.slots.filter(
              (s) => new Date(s.starts_at).getTime() >= cutoff && s.starts_at !== startsAt,
            ),
          }))
          .filter((d) => d.slots.length > 0);
        setDays(out);
        setActiveDay(out[0]?.date ?? null);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, startsAt]);

  async function move() {
    if (!slot) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("swap-booking", {
      body: { action: "move", booking_id: bookingId, starts_at: slot.starts_at, resource_id: bed },
    });
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo mover la clase."));
      return;
    }
    router.refresh();
  }

  if (!days) {
    return (
      <div className="mt-4 flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (days.length === 0) {
    return (
      <p className={cn("mt-4 text-sm", error ? "text-danger" : "text-fg-faint")} role={error ? "alert" : undefined}>
        {error ?? "No hay otros horarios libres esta semana."}
      </p>
    );
  }
  const day = days.find((d) => d.date === activeDay);
  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs text-fg-faint">Movés solo esta clase. Tu horario fijo no cambia.</p>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => (
          <Button
            key={d.date}
            size="sm"
            variant={d.date === activeDay ? "default" : "outline"}
            aria-pressed={d.date === activeDay}
            onClick={() => {
              setActiveDay(d.date);
              setSlot(null);
            }}
          >
            {dateLabel(d.date)}
          </Button>
        ))}
      </div>
      {day && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {day.slots.map((s) => {
            const sel = slot?.starts_at === s.starts_at;
            return (
              <Button
                key={s.starts_at}
                type="button"
                variant={sel ? "default" : "outline"}
                className="font-mono font-normal tabular-nums"
                onClick={() => {
                  setSlot(s);
                  const keep = s.free_resources.find((r) => r.id === resourceId);
                  setBed((keep ?? s.free_resources[0])?.id ?? null);
                }}
              >
                {fmtTime(s.starts_at, timezone)}
              </Button>
            );
          })}
        </div>
      )}
      {slot && slot.free_resources.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">Cama</span>
          {slot.free_resources.map((r) => (
            <Button
              key={r.id}
              size="sm"
              variant={bed === r.id ? "default" : "outline"}
              aria-pressed={bed === r.id}
              onClick={() => setBed(r.id)}
            >
              {r.name}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button disabled={!slot || busy} onClick={move}>
        {busy
          ? "Moviendo…"
          : slot
            ? `Mover al ${dateLabel(localDate(slot.starts_at, timezone))} ${fmtTime(slot.starts_at, timezone)}`
            : "Elegí un horario"}
      </Button>
    </div>
  );
}

function SwapPanel({
  bookingId,
  timezone,
  outgoingRequestId,
}: {
  bookingId: string;
  timezone: string;
  outgoingRequestId: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    if (outgoingRequestId) return;
    let live = true;
    supabase.rpc("swap_candidates", { p_booking: bookingId }).then(({ data, error: err }) => {
      if (!live) return;
      if (err) setError("No pudimos cargar las clases para intercambiar.");
      setCandidates((data ?? []) as Candidate[]);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId, outgoingRequestId]);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("swap-booking", { body });
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo completar."));
      return false;
    }
    return true;
  }

  if (outgoingRequestId) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <p className="text-sm text-fg-muted">
          Ya ofreciste esta clase. Si la otra persona acepta, se intercambian solas.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            if (await call({ action: "cancel", request_id: outgoingRequestId })) router.refresh();
          }}
        >
          {busy ? "Cancelando…" : "Cancelar propuesta"}
        </Button>
      </div>
    );
  }

  if (sent) {
    return (
      <p className="mt-4 text-sm text-accent" role="status">
        Le avisamos a {sent}. Si acepta, las clases se intercambian solas.
      </p>
    );
  }
  if (!candidates) {
    return <Skeleton className="mt-4 h-24 w-full" aria-hidden="true" />;
  }
  if (candidates.length === 0) {
    return (
      <p className={cn("mt-4 text-sm", error ? "text-danger" : "text-fg-faint")}>
        {error ?? "No hay otras clases esta semana para intercambiar."}
      </p>
    );
  }
  const chosen = candidates.find((c) => c.booking_id === target);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <ul className="flex flex-col gap-2" role="radiogroup" aria-label="Clases para intercambiar">
        {candidates.map((c) => {
          const sel = c.booking_id === target;
          return (
            <li key={c.booking_id}>
              <button
                type="button"
                role="radio"
                aria-checked={sel}
                onClick={() => setTarget(c.booking_id)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                  sel ? "border-accent bg-accent/10" : "border-border hover:border-border-strong",
                )}
              >
                <span className="text-fg">
                  {dateLabel(localDate(c.starts_at, timezone))}{" "}
                  <span className="font-mono">{fmtTime(c.starts_at, timezone)}</span>
                  <span className="text-fg-faint"> · {c.resource_name}</span>
                </span>
                <span className="shrink-0 text-fg-muted">{c.client_label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button
        disabled={!chosen || busy}
        onClick={async () => {
          if (!chosen) return;
          if (await call({ action: "propose", from_booking_id: bookingId, to_booking_id: chosen.booking_id })) {
            setSent(chosen.client_label);
            router.refresh();
          }
        }}
      >
        {busy ? "Enviando…" : "Proponer intercambio"}
      </Button>
    </div>
  );
}
