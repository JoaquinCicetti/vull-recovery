"use client";

import { useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

// One sector's agenda, policies and launch switch. Recovery is the business
// itself, so it has no "visible" switch: hiding it would take the site offline.
// `hasMonthly` shows the abono billing policy (due day, surcharge, release day).
export function SectorForm({
  sector,
  hours,
  hasMonthly,
}: {
  sector: Sector;
  hours: SectorHours[];
  hasMonthly: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [active, setActive] = useState(sector.active);
  const [week, setWeek] = useState<WeekHours>(() => toWeekHours(hours));
  const [tz, setTz] = useState(sector.timezone);
  const [lead, setLead] = useState(String(sector.lead_minutes));
  const [hold, setHold] = useState(String(sector.hold_minutes));
  const [notice, setNotice] = useState(String(sector.cancel_notice_hours));
  const [change, setChange] = useState(String(sector.change_notice_hours));
  const [dueDay, setDueDay] = useState(String(sector.due_day));
  const [lateFee, setLateFee] = useState(String(sector.late_fee_pct));
  const [releaseDay, setReleaseDay] = useState(String(sector.release_day));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canHide = sector.slug !== "recovery";

  function touch<T>(set: (v: T) => void) {
    return (v: T) => {
      setSaved(false);
      set(v);
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const hoursError = weekHoursError(week);
    if (hoursError) {
      setError(hoursError);
      return;
    }
    if (Number(hold) < 1) {
      setError("La reserva sin pagar tiene que durar al menos 1 minuto.");
      return;
    }
    const due = Number(dueDay);
    const release = Number(releaseDay);
    if (hasMonthly && !(due >= 1 && due < release && release <= 28)) {
      setError("El vencimiento tiene que ser anterior al día de liberar el lugar (máximo 28).");
      return;
    }
    if (hasMonthly && Number(lateFee) > 100) {
      setError("El recargo no puede superar el 100 %.");
      return;
    }

    setBusy(true);
    const [{ error: sectorError }, { error: hoursErr }] = await Promise.all([
      supabase
        .from("sectors")
        .update({
          active: canHide ? active : true,
          timezone: tz,
          lead_minutes: Number(lead) || 0,
          hold_minutes: Number(hold),
          cancel_notice_hours: Number(notice) || 0,
          change_notice_hours: Number(change) || 0,
          ...(hasMonthly
            ? { due_day: due, late_fee_pct: Number(lateFee) || 0, release_day: release }
            : {}),
        })
        .eq("id", sector.id),
      supabase.rpc("set_sector_hours", { p_sector: sector.id, p_hours: fromWeekHours(week) }),
    ]);
    setBusy(false);
    const err = sectorError ?? hoursErr;
    if (err) {
      setError(
        err.code === "23P01" ? "Dos rangos del mismo día se superponen." : err.message,
      );
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      {canHide && (
        <Label className="gap-2.5 text-fg-muted">
          <Switch checked={active} onCheckedChange={touch(setActive)} />
          <span>
            <span className="font-medium text-fg">Visible para clientes</span>
            <span className="block text-xs text-fg-faint">
              Apagado: solo los admins ven sus planes y pueden reservar.
            </span>
          </span>
        </Label>
      )}

      <WeekdayHoursEditor idPrefix={sector.id} value={week} onChange={touch(setWeek)} />

      <div className="flex flex-col gap-1.5">
        <Label className="text-fg-muted">Zona horaria</Label>
        <Select value={tz} onValueChange={touch(setTz)}>
          <SelectTrigger className="w-full sm:w-fit">
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

      <div className="flex flex-wrap gap-4">
        <NumberField
          id={`${sector.id}-lead`}
          label="Anticipación mínima (min)"
          value={lead}
          onChange={touch(setLead)}
        />
        <NumberField
          id={`${sector.id}-hold`}
          label="Reserva sin pagar (min)"
          value={hold}
          onChange={touch(setHold)}
        />
        <NumberField
          id={`${sector.id}-notice`}
          label="Aviso para cancelar (h)"
          value={notice}
          onChange={touch(setNotice)}
        />
        {canHide && (
          <NumberField
            id={`${sector.id}-change`}
            label="Aviso para mover o cambiar (h)"
            value={change}
            onChange={touch(setChange)}
          />
        )}
      </div>
      <p className="-mt-2 text-xs text-fg-faint">
        Si el cliente cancela un turno pago con al menos ese aviso, recupera la sesión
        como crédito.{canHide && " Las clases de un abono se pueden mover o intercambiar hasta ese aviso."}
      </p>

      {hasMonthly && (
        <fieldset className="flex flex-col gap-3 border-t border-border pt-5">
          <legend className="text-sm font-medium text-fg">Abonos mensuales</legend>
          <div className="flex flex-wrap gap-4">
            <NumberField
              id={`${sector.id}-due`}
              label="Pagar antes del día"
              value={dueDay}
              onChange={touch(setDueDay)}
            />
            <NumberField
              id={`${sector.id}-fee`}
              label="Recargo por atraso (%)"
              value={lateFee}
              onChange={touch(setLateFee)}
            />
            <NumberField
              id={`${sector.id}-release`}
              label="Liberar lugar desde el día"
              value={releaseDay}
              onChange={touch(setReleaseDay)}
            />
          </div>
          <p className="text-xs text-fg-faint">
            La cuota de cada mes vence el {dueDay || "—"}. Después se cobra {lateFee || "0"} % de
            recargo. Desde el {releaseDay || "—"}, las cuotas impagas aparecen en el Inicio para
            liberar el lugar a mano.
          </p>
        </fieldset>
      )}

      <div className="flex items-center gap-3">
        <Button className="self-start" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
        {saved && <span className="text-sm text-accent">Guardado ✓</span>}
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
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

// The sector's resources (pilates beds). For a single class the DB assigns the
// first free one; an abono member picks theirs. Resources with turnos can't be
// deleted, only deactivated.
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
    while (taken.has(`Cama ${n}`)) n++;
    run(
      supabase.from("resources").insert({
        sector_id: sector.id,
        name: `Cama ${n}`,
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
          Agregar cama
        </Button>
      </div>
      <ul className="flex flex-col gap-2">
        {resources.map((r) => (
          <ResourceRow
            key={r.id}
            resource={r}
            busy={busy}
            lastActive={r.active && activeCount === 1}
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
  onSave,
}: {
  resource: Resource;
  busy: boolean;
  lastActive: boolean;
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
          Inactiva
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
