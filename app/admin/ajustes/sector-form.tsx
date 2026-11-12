"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Resource, Sector, SectorHours } from "@/lib/types";
import {
  WeekdayHoursEditor,
  fromWeekHours,
  toWeekHours,
  weekHoursError,
  type WeekHours,
} from "@/components/admin/weekday-hours-editor";
import { EditDialog, SettingRow, SettingsGroup } from "@/components/admin/settings/setting-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { WEEK_ORDER, WEEKDAY_LONG, WEEKDAY_SHORT, hm } from "@/lib/membership";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TIMEZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Cordoba",
  "America/Argentina/Mendoza",
  "America/Argentina/Salta",
  "America/Argentina/Tucuman",
];

const digits = (v: string) => v.replace(/\D/g, "");

/** "Lun–Vie 08:00–20:00 · Sáb 09:00–13:00": consecutive days with the same ranges merge. */
function hoursSummary(week: WeekHours): string {
  const key = (d: number) => week[d].map((r) => `${r.opens}–${r.closes}`).join(", ");
  const parts: string[] = [];
  let i = 0;
  while (i < WEEK_ORDER.length) {
    const d = WEEK_ORDER[i];
    let j = i;
    while (j + 1 < WEEK_ORDER.length && key(WEEK_ORDER[j + 1]) === key(d)) j++;
    if (week[d].length) {
      const days = i === j ? WEEKDAY_SHORT[d] : `${WEEKDAY_SHORT[d]}–${WEEKDAY_SHORT[WEEK_ORDER[j]]}`;
      parts.push(`${days} ${key(d)}`);
    }
    i = j + 1;
  }
  if (!parts.length) return "Cerrado todos los días";
  const slots = new Set(WEEK_ORDER.flatMap((d) => week[d].map((r) => r.slot_minutes)));
  parts.push(slots.size === 1 ? `turnos de ${[...slots][0]} min` : "turnos de distinta duración");
  return parts.join(" · ");
}

function windowSummary(s: Sector): string {
  return s.booking_window === "rolling"
    ? `Próximos ${s.rolling_days} días`
    : `Semana en curso · la siguiente abre el ${WEEKDAY_LONG[s.next_week_opens_dow].toLowerCase()} ${hm(s.next_week_opens_at)}`;
}

type Patch = Partial<Omit<Sector, "id" | "slug" | "name" | "sort_order">>;

/** Saves one setting's columns of the sector; returns an error message or null. */
function useSectorSave(sector: Sector) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(patch: Patch): Promise<boolean> {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("sectors").update(patch).eq("id", sector.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return false;
    }
    router.refresh();
    return true;
  }
  return { busy, error, setError, save, setBusy };
}

type Editor = "hours" | "window" | "rules" | "monthly" | "places" | null;

// One sector's agenda, policies and switches as a settings list: each row says
// what it is set to now and opens its own editor, which saves only its fields.
// Recovery is the business itself, so it has no "visible" switch: hiding it
// would take the site offline. `hasMonthly` shows the abono billing policy.
export function SectorSettings({
  sector,
  hours,
  resources,
  hasMonthly,
}: {
  sector: Sector;
  hours: SectorHours[];
  resources: Resource[];
  hasMonthly: boolean;
}) {
  const [open, setOpen] = useState<Editor>(null);
  const toggles = useSectorSave(sector);
  const canHide = sector.slug !== "recovery";
  const week = toWeekHours(hours);
  const activePlaces = resources.filter((r) => r.active);
  const close = (o: boolean) => !o && setOpen(null);

  return (
    <>
      <SettingsGroup
        title={`Disponibilidad · ${sector.name}`}
        description="Cuándo se puede reservar, de cuántos minutos es cada turno y cuántos entran a la vez."
      >
        {canHide && (
          <SettingRow
            label="Visible para clientes"
            value={sector.active ? "Sí: los planes se ven en la web" : "No: solo los admins ven sus planes"}
            trailing={
              <Switch
                checked={sector.active}
                disabled={toggles.busy}
                onCheckedChange={(active) => toggles.save({ active })}
                aria-label="Visible para clientes"
              />
            }
          />
        )}
        <SettingRow label="Horarios" value={hoursSummary(week)} onEdit={() => setOpen("hours")} />
        <SettingRow label="Ventana de reserva" value={windowSummary(sector)} onEdit={() => setOpen("window")} />
        <SettingRow
          label="Reglas de reserva"
          value={`Anticipación ${sector.lead_minutes} min · sin pagar ${sector.hold_minutes} min · cancelar ${sector.cancel_notice_hours} h${
            canHide ? ` · mover ${sector.change_notice_hours} h` : ""
          }`}
          onEdit={() => setOpen("rules")}
        />
        {hasMonthly && (
          <SettingRow
            label="Abonos mensuales"
            value={`Vence el ${sector.due_day} · recargo ${sector.late_fee_pct} % · libera el ${sector.release_day}`}
            onEdit={() => setOpen("monthly")}
          />
        )}
        <SettingRow
          label={sector.slug === "pilates" ? "Camas" : "Lugares simultáneos"}
          value={`${activePlaces.length} ${activePlaces.length === 1 ? "activo" : "activos"}${
            activePlaces.length ? `: ${activePlaces.map((r) => r.name).join(", ")}` : ""
          }`}
          onEdit={() => setOpen("places")}
        />
        <SettingRow
          label="Encuestas post-sesión"
          value={
            sector.survey_enabled
              ? "Se envían por WhatsApp desde Agenda › Turnos pasados"
              : "Apagadas para este sector"
          }
          trailing={
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/ajustes/encuesta?sector=${sector.slug}`}>
                  <Eye data-icon="inline-start" aria-hidden />
                  Vista previa
                </Link>
              </Button>
              <Switch
              checked={sector.survey_enabled}
              disabled={toggles.busy}
                onCheckedChange={(survey_enabled) => toggles.save({ survey_enabled })}
                aria-label="Encuestas post-sesión"
              />
            </>
          }
        />
      </SettingsGroup>
      {toggles.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {toggles.error}
        </p>
      )}

      {open === "hours" && <HoursDialog sector={sector} hours={hours} onOpenChange={close} />}
      {open === "window" && <WindowDialog sector={sector} onOpenChange={close} />}
      {open === "rules" && <RulesDialog sector={sector} canHide={canHide} onOpenChange={close} />}
      {open === "monthly" && <MonthlyDialog sector={sector} onOpenChange={close} />}
      <EditDialog
        open={open === "places"}
        onOpenChange={close}
        title={sector.slug === "pilates" ? "Camas" : "Lugares simultáneos"}
        description="Cuántos turnos entran en un mismo horario. Para un turno suelto se asigna el primero libre; un abono elige el suyo."
      >
        <ResourcesEditor sector={sector} resources={resources} />
      </EditDialog>
    </>
  );
}

function HoursDialog({
  sector,
  hours,
  onOpenChange,
}: {
  sector: Sector;
  hours: SectorHours[];
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [week, setWeek] = useState<WeekHours>(() => toWeekHours(hours));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const hoursError = weekHoursError(week);
    if (hoursError) {
      setError(hoursError);
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("set_sector_hours", { p_sector: sector.id, p_hours: fromWeekHours(week) });
    setBusy(false);
    if (error) {
      setError(error.code === "23P01" ? "Dos rangos del mismo día se superponen." : error.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <EditDialog
      open
      onOpenChange={onOpenChange}
      title={`Horarios · ${sector.name}`}
      description="Los rangos de cada día se cortan en turnos de la duración elegida."
      onSave={save}
      busy={busy}
      error={error}
    >
      <WeekdayHoursEditor idPrefix={sector.id} value={week} onChange={setWeek} />
    </EditDialog>
  );
}

function WindowDialog({ sector, onOpenChange }: { sector: Sector; onOpenChange: (o: boolean) => void }) {
  const { busy, error, setError, save } = useSectorSave(sector);
  const [bookingWin, setBookingWin] = useState(sector.booking_window);
  const [rollingDays, setRollingDays] = useState(String(sector.rolling_days));
  const [opensDow, setOpensDow] = useState(String(sector.next_week_opens_dow));
  const [opensAt, setOpensAt] = useState(hm(sector.next_week_opens_at));

  async function submit() {
    const days = Number(rollingDays);
    if (bookingWin === "rolling" && !(days >= 1 && days <= 90)) {
      setError("Se puede reservar con entre 1 y 90 días de anticipación.");
      return;
    }
    if (bookingWin === "week" && !opensAt) {
      setError("Elegí a qué hora se habilita la semana siguiente.");
      return;
    }
    const ok = await save({
      booking_window: bookingWin,
      ...(bookingWin === "rolling"
        ? { rolling_days: days }
        : { next_week_opens_dow: Number(opensDow), next_week_opens_at: opensAt }),
    });
    if (ok) onOpenChange(false);
  }

  return (
    <EditDialog open onOpenChange={onOpenChange} title="Ventana de reserva" onSave={submit} busy={busy} error={error}>
      <Select value={bookingWin} onValueChange={(v) => setBookingWin(v as Sector["booking_window"])}>
        <SelectTrigger className="w-full" aria-label="Ventana de reserva">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="week">Semana actual, lunes a domingo</SelectItem>
          <SelectItem value="rolling">Próximos N días</SelectItem>
        </SelectContent>
      </Select>
      {bookingWin === "rolling" ? (
        <NumberField id={`${sector.id}-rolling`} label="Días" value={rollingDays} onChange={setRollingDays} />
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <Field id={`${sector.id}-opens-dow`} label="La semana siguiente se habilita el">
            <Select value={opensDow} onValueChange={setOpensDow}>
              <SelectTrigger id={`${sector.id}-opens-dow`} className="w-fit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_ORDER.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {WEEKDAY_LONG[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id={`${sector.id}-opens-at`} label="a las">
            <Input
              id={`${sector.id}-opens-at`}
              type="time"
              className="w-fit font-mono"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              required
            />
          </Field>
        </div>
      )}
      <p className="text-xs text-fg-faint">
        {bookingWin === "rolling"
          ? `Los clientes pueden reservar en los próximos ${rollingDays || "—"} días.`
          : `Los clientes reservan dentro de la semana en curso. La semana siguiente se habilita el ${WEEKDAY_LONG[Number(opensDow)].toLowerCase()} a las ${opensAt || "—"}.`}{" "}
        Los admins pueden reprogramar más adelante.
      </p>
    </EditDialog>
  );
}

function RulesDialog({
  sector,
  canHide,
  onOpenChange,
}: {
  sector: Sector;
  canHide: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { busy, error, setError, save } = useSectorSave(sector);
  const [tz, setTz] = useState(sector.timezone);
  const [lead, setLead] = useState(String(sector.lead_minutes));
  const [hold, setHold] = useState(String(sector.hold_minutes));
  const [notice, setNotice] = useState(String(sector.cancel_notice_hours));
  const [change, setChange] = useState(String(sector.change_notice_hours));

  async function submit() {
    if (Number(hold) < 1) {
      setError("La reserva sin pagar tiene que durar al menos 1 minuto.");
      return;
    }
    const ok = await save({
      timezone: tz,
      lead_minutes: Number(lead) || 0,
      hold_minutes: Number(hold),
      cancel_notice_hours: Number(notice) || 0,
      change_notice_hours: Number(change) || 0,
    });
    if (ok) onOpenChange(false);
  }

  return (
    <EditDialog open onOpenChange={onOpenChange} title="Reglas de reserva" onSave={submit} busy={busy} error={error}>
      <div className="grid grid-cols-2 gap-4">
        <NumberField id={`${sector.id}-lead`} label="Anticipación mínima (min)" value={lead} onChange={setLead} />
        <NumberField id={`${sector.id}-hold`} label="Reserva sin pagar (min)" value={hold} onChange={setHold} />
        <NumberField id={`${sector.id}-notice`} label="Aviso para cancelar (h)" value={notice} onChange={setNotice} />
        {canHide && (
          <NumberField
            id={`${sector.id}-change`}
            label="Aviso para mover o cambiar (h)"
            value={change}
            onChange={setChange}
          />
        )}
      </div>
      <p className="text-xs text-fg-faint">
        Si el cliente cancela un turno pago con al menos ese aviso, recupera la sesión como crédito.
        {canHide && " Las clases de un abono se pueden mover o intercambiar hasta ese aviso."}
      </p>
      <div className="flex flex-col gap-1.5">
        <Label className="text-fg-muted">Zona horaria</Label>
        <Select value={tz} onValueChange={setTz}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Zona horaria" />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((z) => (
              <SelectItem key={z} value={z}>
                {z}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </EditDialog>
  );
}

function MonthlyDialog({ sector, onOpenChange }: { sector: Sector; onOpenChange: (o: boolean) => void }) {
  const { busy, error, setError, save } = useSectorSave(sector);
  const [dueDay, setDueDay] = useState(String(sector.due_day));
  const [lateFee, setLateFee] = useState(String(sector.late_fee_pct));
  const [releaseDay, setReleaseDay] = useState(String(sector.release_day));

  async function submit() {
    const due = Number(dueDay);
    const release = Number(releaseDay);
    if (!(due >= 1 && due < release && release <= 28)) {
      setError("El vencimiento tiene que ser anterior al día de liberar el lugar (máximo 28).");
      return;
    }
    if (Number(lateFee) > 100) {
      setError("El recargo no puede superar el 100 %.");
      return;
    }
    const ok = await save({ due_day: due, late_fee_pct: Number(lateFee) || 0, release_day: release });
    if (ok) onOpenChange(false);
  }

  return (
    <EditDialog open onOpenChange={onOpenChange} title="Abonos mensuales" onSave={submit} busy={busy} error={error}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <NumberField id={`${sector.id}-due`} label="Pagar antes del día" value={dueDay} onChange={setDueDay} />
        <NumberField id={`${sector.id}-fee`} label="Recargo por atraso (%)" value={lateFee} onChange={setLateFee} />
        <NumberField
          id={`${sector.id}-release`}
          label="Liberar lugar desde el día"
          value={releaseDay}
          onChange={setReleaseDay}
        />
      </div>
      <p className="text-xs text-fg-faint">
        La cuota de cada mes vence el {dueDay || "—"}. Después se cobra {lateFee || "0"} % de recargo. Desde el{" "}
        {releaseDay || "—"}, las cuotas impagas se filtran en Agenda › Abonos para liberar el lugar a mano.
      </p>
    </EditDialog>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        className="w-28 font-mono"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(digits(e.target.value))}
        required
      />
    </Field>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-fg-muted">
        {label}
      </Label>
      {children}
    </div>
  );
}

// The sector's resources (pilates beds, recovery's places): how many turnos fit
// in one slot. For a single turno the DB assigns the first free one; an abono
// member picks theirs. Resources with turnos can't be deleted, only deactivated.
export function ResourcesEditor({
  sector,
  resources,
}: {
  sector: Sector;
  resources: Resource[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const activeCount = resources.filter((r) => r.active).length;
  // Pilates has beds; recovery just has places for simultaneous turnos.
  const noun = sector.slug === "pilates" ? "Cama" : "Lugar";

  async function run(op: PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error } = await op;
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  function add() {
    const taken = new Set(resources.map((r) => r.name));
    let n = resources.length + 1;
    while (taken.has(`${noun} ${n}`)) n++;
    run(
      supabase.from("resources").insert({
        sector_id: sector.id,
        name: `${noun} ${n}`,
        sort_order: resources.length,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-fg-muted">
          Lugares simultáneos:{" "}
          <span className="font-mono font-semibold text-fg">{activeCount}</span>
        </span>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={busy}>
          Agregar {noun.toLowerCase()}
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {resources.map((r) => (
          <ResourceRow
            key={r.id}
            resource={r}
            busy={busy}
            lastActive={r.active && activeCount === 1}
            inactiveLabel={noun === "Cama" ? "Inactiva" : "Inactivo"}
            onSave={(patch) => run(supabase.from("resources").update(patch).eq("id", r.id))}
          />
        ))}
      </ul>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ResourceRow({
  resource,
  busy,
  lastActive,
  inactiveLabel,
  onSave,
}: {
  resource: Resource;
  busy: boolean;
  lastActive: boolean;
  inactiveLabel: string;
  onSave: (patch: Partial<Pick<Resource, "name" | "active">>) => void;
}) {
  const [name, setName] = useState(resource.name);
  const dirty = name.trim() !== resource.name && name.trim() !== "";
  return (
    <li className="flex items-center gap-3">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1"
        aria-label="Nombre"
      />
      {dirty && (
        <Button type="button" size="sm" disabled={busy} onClick={() => onSave({ name: name.trim() })}>
          Guardar
        </Button>
      )}
      {!resource.active && (
        <Badge variant="outline" className="text-xs text-fg-faint">
          {inactiveLabel}
        </Badge>
      )}
      <Switch
        checked={resource.active}
        // The last active one stays: a sector with none can't take turnos.
        disabled={busy || lastActive}
        onCheckedChange={(active) => onSave({ active })}
        aria-label="Activa"
      />
    </li>
  );
}
