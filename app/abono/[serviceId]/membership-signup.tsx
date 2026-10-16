"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { formatARS } from "@/lib/site";
import {
  dateLabel,
  monthEnd,
  quoteFirstPeriod,
  type MembershipAvailability,
  type SchedulePick,
} from "@/lib/membership";
import type { Profile, Sector, Service } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WeeklySchedulePicker } from "@/components/membership/weekly-schedule-picker";
import { MembershipScheduleChips } from "@/components/membership/schedule-chips";
import { ContactDetailsFields } from "@/components/contact-details-fields";

type SectorInfo = Pick<
  Sector,
  "id" | "name" | "timezone" | "due_day" | "late_fee_pct" | "release_day" | "hold_minutes"
>;

const draftKey = (id: string) => `abono:${id}`;

export function MembershipSignup({
  service,
  sector,
  today,
  isAuthed,
  profile,
}: {
  service: Service;
  sector: SectorInfo;
  today: string;
  isAuthed: boolean;
  profile: Profile | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const n = service.classes_per_week ?? 1;
  const lastDay = monthEnd(today);

  const [step, setStep] = useState<"start" | "schedule">("start");
  const [startMode, setStartMode] = useState<"today" | "other">("today");
  const [startsOn, setStartsOn] = useState(today);
  const [locked, setLocked] = useState(false);
  const [picks, setPicks] = useState<SchedulePick[]>([]);
  const [avail, setAvail] = useState<MembershipAvailability | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const pending = submitting || navigating;
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.whatsapp_phone ?? "");
  const [showDetails, setShowDetails] = useState(false);
  const detailsMissing = !profile?.full_name || !profile?.whatsapp_phone;

  // Coming back from /login: restore what was chosen before signing in. The
  // draft lives in sessionStorage, which doesn't exist during render.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(service.id));
      if (!raw) return;
      const d = JSON.parse(raw);
      if (typeof d.startsOn === "string" && d.startsOn >= today && d.startsOn <= lastDay) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStartsOn(d.startsOn);
        setStartMode(d.startsOn === today ? "today" : "other");
      }
      if (typeof d.locked === "boolean") setLocked(d.locked);
      if (Array.isArray(d.picks)) setPicks(d.picks);
      if (d.step === "schedule") setStep("schedule");
      sessionStorage.removeItem(draftKey(service.id));
    } catch {
      /* private mode / bad JSON: start fresh */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toLogin() {
    try {
      sessionStorage.setItem(
        draftKey(service.id),
        JSON.stringify({ startsOn, locked, picks, step }),
      );
    } catch {
      /* fine */
    }
    router.push(`/login?next=${encodeURIComponent(`/abono/${service.id}`)}`);
  }

  async function submit() {
    if (picks.length !== n) return;
    if (!isAuthed) return toLogin();
    if (detailsMissing && !showDetails) {
      setShowDetails(true);
      return;
    }
    if (showDetails && !name.trim()) {
      setError("Necesitamos tu nombre para el abono.");
      return;
    }
    setSubmitting(true);
    setError(null);
    if (showDetails) {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({ full_name: name.trim(), whatsapp_phone: phone.trim() || null })
        .eq("id", profile?.id ?? "");
      if (pErr) {
        setSubmitting(false);
        setError("No se pudieron guardar tus datos. Probá de nuevo.");
        return;
      }
    }
    const { data, error: fnErr } = await supabase.functions.invoke("membership", {
      body: { action: "create", service_id: service.id, slots: picks, locked, starts_on: startsOn },
    });
    if (fnErr || !data?.period?.id) {
      setSubmitting(false);
      setError(await readError(fnErr, "No pudimos reservar tu horario. Probá de nuevo."));
      return;
    }
    startNavigation(() => router.push(`/cuenta/plan/pagar/${data.period.id}`));
  }

  const quote = avail ? quoteFirstPeriod(avail, picks.map((p) => p.weekday)) : null;
  const bedNames = new Map((avail?.resources ?? []).map((r) => [r.id, r.name]));
  const prorated = quote && quote.classes < quote.full;

  if (step === "start") {
    return (
      <div className="mt-10 flex flex-col gap-8">
        <section>
          <p className="eyebrow">¿Cuándo empezás?</p>
          <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Inicio">
            {(["today", "other"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={startMode === m}
                variant={startMode === m ? "default" : "outline"}
                onClick={() => {
                  setStartMode(m);
                  if (m === "today") setStartsOn(today);
                }}
              >
                {m === "today" ? "Hoy" : "Otro día"}
              </Button>
            ))}
          </div>
          {startMode === "other" && (
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="abono-start">Fecha de inicio</Label>
              <Input
                id="abono-start"
                type="date"
                className="w-fit font-mono"
                min={today}
                max={lastDay}
                value={startsOn}
                onChange={(e) => e.target.value && setStartsOn(e.target.value)}
              />
            </div>
          )}
          <p className="mt-3 text-sm leading-relaxed text-fg-muted">
            El abono va por mes calendario. Si empezás después del 1°, este mes pagás solo
            las clases que quedan.
          </p>
        </section>

        <section className="surface-card p-5">
          <Label htmlFor="abono-lock" className="items-start gap-3">
            <Switch id="abono-lock" checked={locked} onCheckedChange={setLocked} className="mt-0.5" />
            <span>
              <span className="font-medium text-fg">Reservar mi lugar todos los meses</span>
              <span className="mt-1 block text-sm font-normal leading-relaxed text-fg-muted">
                {locked
                  ? `Tus días, horarios y cama quedan fijos mes a mes. Pagás la cuota hasta el ${sector.due_day} de cada mes; después tiene un ${sector.late_fee_pct} % de recargo, y si no está paga al ${sector.release_day}, el lugar se puede liberar para otra persona.`
                  : "Sin reservar: el abono termina con el mes y, si querés seguir, volvés a elegir horarios entre los que estén libres."}
              </span>
            </span>
          </Label>
        </section>

        <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-bg/95 px-5 py-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button size="lg" className="w-full" onClick={() => setStep("schedule")}>
            Elegir horarios
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-10 flex flex-col gap-6 pb-4">
      <button
        type="button"
        onClick={() => setStep("start")}
        className="self-start text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline"
      >
        ← Desde el {dateLabel(startsOn)} · {locked ? "todos los meses" : "solo este mes"}
      </button>

      <WeeklySchedulePicker
        serviceId={service.id}
        startsOn={startsOn}
        locked={locked}
        classesPerWeek={n}
        value={picks}
        onChange={setPicks}
        onData={setAvail}
      />

      {showDetails && (
        <ContactDetailsFields
          idPrefix="abono"
          name={name}
          phone={phone}
          onName={setName}
          onPhone={setPhone}
          purpose="Los usamos para tu abono y para coordinar con vos."
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 border-t border-border bg-bg/95 px-5 py-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        {picks.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5">
            <MembershipScheduleChips
              size="sm"
              locked={locked}
              slots={picks.map((p) => ({ ...p, resource_name: bedNames.get(p.resource_id) }))}
            />
            {quote && picks.length === n && (
              <p className="text-xs text-fg-muted">
                <span className="font-mono">{quote.classes}</span>{" "}
                {quote.classes === 1 ? "clase" : "clases"} este mes ·{" "}
                <span className={cn("font-mono font-semibold", prorated ? "text-accent" : "text-fg")}>
                  {prorated ? "≈ " : ""}
                  {formatARS(quote.amount)}
                </span>
                {prorated && <span className="text-fg-faint"> (proporcional)</span>}
              </p>
            )}
          </div>
        )}
        <Button size="lg" className="w-full" disabled={picks.length !== n || pending} onClick={submit}>
          {pending
            ? "Reservando…"
            : picks.length < n
              ? `Elegí ${n - picks.length} ${n - picks.length === 1 ? "día" : "días"} más`
              : !isAuthed
                ? "Ingresar y reservar mi lugar"
                : showDetails
                  ? "Confirmar y pagar"
                  : "Reservar mi lugar"}
        </Button>
        {picks.length === n && isAuthed && (
          <p className="mt-2 text-center text-xs text-fg-faint">
            Te guardamos el horario {sector.hold_minutes} min mientras pagás la cuota.
          </p>
        )}
      </div>
    </div>
  );
}
