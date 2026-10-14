"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Resource, Sector } from "@/lib/types";
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

// Weekdays in display order (Mon→Sun), mapped to JS getUTCDay() numbers
// (0=Sun … 6=Sat) — the same convention the availability function uses.
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mié" },
  { value: 4, label: "Jue" },
  { value: 5, label: "Vie" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
];

const TIMEZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Cordoba",
  "America/Argentina/Mendoza",
  "America/Argentina/Salta",
  "America/Argentina/Tucuman",
];

// "09:00:00" → "09:00" for <input type="time">
const toHM = (t: string) => t.slice(0, 5);
const digits = (v: string) => v.replace(/\D/g, "");

// One sector's agenda, policies and launch switch. Recovery is the business
// itself, so it has no "visible" switch: hiding it would take the site offline.
export function SectorForm({ sector }: { sector: Sector }) {
  const router = useRouter();
  const supabase = createClient();
  const [active, setActive] = useState(sector.active);
  const [start, setStart] = useState(toHM(sector.working_hours_start));
  const [end, setEnd] = useState(toHM(sector.working_hours_end));
  const [days, setDays] = useState<number[]>(sector.working_days ?? []);
  const [tz, setTz] = useState(sector.timezone);
  const [lead, setLead] = useState(String(sector.lead_minutes));
  const [hold, setHold] = useState(String(sector.hold_minutes));
  const [notice, setNotice] = useState(String(sector.cancel_notice_hours));
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

  function toggleDay(value: number) {
    setSaved(false);
    setDays((d) =>
      d.includes(value) ? d.filter((x) => x !== value) : [...d, value],
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (end <= start) {
      setError("La hora de cierre debe ser posterior a la de apertura.");
      return;
    }
    if (days.length === 0) {
      setError("Elegí al menos un día de atención.");
      return;
    }
    if (Number(hold) < 1) {
      setError("La reserva sin pagar tiene que durar al menos 1 minuto.");
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("sectors")
      .update({
        active: canHide ? active : true,
        working_hours_start: start,
        working_hours_end: end,
        working_days: [...days].sort((a, b) => a - b),
        timezone: tz,
        lead_minutes: Number(lead) || 0,
        hold_minutes: Number(hold),
        cancel_notice_hours: Number(notice) || 0,
      })
      .eq("id", sector.id);
    setBusy(false);
    if (error) {
      setError(error.message);
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

      <div className="flex flex-wrap gap-4">
        <Field id={`${sector.id}-start`} label="Abre">
          <Input
            id={`${sector.id}-start`}
            type="time"
            className="w-fit font-mono"
            value={start}
            onChange={(e) => touch(setStart)(e.target.value)}
            required
          />
        </Field>
        <Field id={`${sector.id}-end`} label="Cierra">
          <Input
            id={`${sector.id}-end`}
            type="time"
            className="w-fit font-mono"
            value={end}
            onChange={(e) => touch(setEnd)(e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm text-fg-muted">Días de atención</span>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = days.includes(d.value);
            return (
              <Button
                key={d.value}
                type="button"
                variant={on ? "default" : "outline"}
                onClick={() => toggleDay(d.value)}
                aria-pressed={on}
                className={on ? undefined : "font-normal text-fg-muted"}
              >
                {d.label}
              </Button>
            );
          })}
        </div>
      </div>

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
        <Field id={`${sector.id}-lead`} label="Anticipación mínima (min)">
          <Input
            id={`${sector.id}-lead`}
            className="w-28 font-mono"
            inputMode="numeric"
            value={lead}
            onChange={(e) => touch(setLead)(digits(e.target.value))}
            required
          />
        </Field>
        <Field id={`${sector.id}-hold`} label="Reserva sin pagar (min)">
          <Input
            id={`${sector.id}-hold`}
            className="w-28 font-mono"
            inputMode="numeric"
            value={hold}
            onChange={(e) => touch(setHold)(digits(e.target.value))}
            required
          />
        </Field>
        <Field id={`${sector.id}-notice`} label="Aviso para cancelar (h)">
          <Input
            id={`${sector.id}-notice`}
            className="w-28 font-mono"
            inputMode="numeric"
            value={notice}
            onChange={(e) => touch(setNotice)(digits(e.target.value))}
            required
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-fg-faint">
        Si el cliente cancela un turno pago con al menos ese aviso, recupera la sesión
        como crédito.
      </p>

      <div className="flex items-center gap-3">
        <Button className="self-start" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
        {saved && <span className="text-sm text-accent">Guardado ✓</span>}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </form>
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

// The sector's resources (pilates beds). Clients never pick one: a time stays
// bookable while any active resource is free, and the DB assigns the first free
// one. Resources with turnos can't be deleted, only deactivated.
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
