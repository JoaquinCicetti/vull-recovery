"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Sector, Service } from "@/lib/types";
import { formatARS } from "@/lib/site";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { EditDialog, SettingsGroup } from "@/components/admin/settings/setting-row";
import { StationsEditor } from "@/components/admin/settings/stations-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// A plan's duration is what the client reads on its card. The turno itself is
// one slot of the sector's grid (Disponibilidad); an abono class lasts this long.
const DURATION_HINT = "Solo informativo. Los turnos los define Disponibilidad.";

/** "Pack · 4 sesiones", "Mensual · 2 clases/sem", "Sesión". */
function kindLabel(s: Pick<Service, "billing" | "classes_per_week" | "sessions_included">) {
  if (s.billing === "monthly") {
    return `Mensual · ${s.classes_per_week} ${s.classes_per_week === 1 ? "clase" : "clases"}/sem`;
  }
  return s.sessions_included > 1 ? `Pack · ${s.sessions_included} sesiones` : "Sesión";
}

// The plans of ONE sector: one row each (what it is, price, whether it shows),
// edited in a dialog. A plan belongs to its sector for good (its turnos are
// filed under it), and so does how it is billed: per session (single or pack)
// or monthly (an abono of N fixed classes a week).
export function ServicesManager({ initial, sector }: { initial: Service[]; sector: Sector }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SettingsGroup
        title={`Planes y precios · ${sector.name}`}
        action={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            Nuevo plan
          </Button>
        }
      >
        {initial.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-fg-faint">{sector.name} no tiene planes todavía.</li>
        ) : (
          initial.map((s) => <ServiceRow key={s.id} service={s} sector={sector} />)
        )}
      </SettingsGroup>
      <ServiceDialog
        key={creating ? "new-open" : "new"}
        open={creating}
        onOpenChange={setCreating}
        sector={sector}
        count={initial.length}
      />
    </>
  );
}

function ServiceRow({ service, sector }: { service: Service; sector: Sector }) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const monthly = service.billing === "monthly";
  const stations = service.stations ?? [];

  async function toggleActive() {
    setBusy(true);
    await supabase.from("services").update({ active: !service.active }).eq("id", service.id);
    setBusy(false);
    router.refresh();
  }

  async function remove(): Promise<string | null> {
    const { error } = await supabase.from("services").delete().eq("id", service.id);
    if (error) return "No se puede eliminar: tiene turnos. Desactivalo en su lugar.";
    router.refresh();
    return null;
  }

  return (
    <li className={cn("flex items-center gap-3 py-1 pl-4 pr-2", !service.active && "opacity-60")}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="min-w-0 flex-1 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">{service.name}</span>
          {!service.active && (
            <span className="shrink-0 rounded border border-border px-1 font-mono text-[10px] uppercase tracking-wider text-fg-faint">
              Oculto
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-sm text-fg-faint">
          <span className="font-mono text-fg-muted">
            {formatARS(service.price_ars)}
            {monthly && "/mes"}
          </span>
          {" · "}
          {kindLabel(service)}
          {" · "}
          <span className="font-mono">{service.duration_minutes} min</span>
          {stations.length > 0 && ` · ${stations.length} incluidos`}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Acciones: ${service.name}`} disabled={busy}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggleActive}>
            {service.active ? <EyeOff /> : <Eye />}
            {service.active ? "Ocultar de la web" : sector.active ? "Mostrar en la web" : "Activar"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ServiceDialog
        key={editing ? `${service.id}-open` : service.id}
        open={editing}
        onOpenChange={setEditing}
        sector={sector}
        service={service}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar el plan"
        description={
          <>
            «{service.name}» desaparece de la web y del panel. Solo se puede eliminar un plan
            sin turnos; si ya tiene, ocultalo.
          </>
        }
        confirmLabel="Sí, eliminar"
        busyLabel="Eliminando…"
        tone="danger"
        onConfirm={remove}
      />
    </li>
  );
}

/**
 * Create (no `service`) or edit a plan. How it is billed is chosen once, at
 * creation; an abono's classes per week too (members' schedules hang on them).
 */
function ServiceDialog({
  open,
  onOpenChange,
  sector,
  service,
  count = 0,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sector: Sector;
  service?: Service;
  count?: number;
}) {
  const router = useRouter();
  const supabase = createClient();
  const editing = Boolean(service);
  const [billing, setBilling] = useState<"session" | "monthly">(service?.billing ?? "session");
  const [name, setName] = useState(service?.name ?? "");
  const [desc, setDesc] = useState(service?.description ?? "");
  const [price, setPrice] = useState(service ? String(service.price_ars) : "");
  const [dur, setDur] = useState(service ? String(service.duration_minutes) : "60");
  const [sessions, setSessions] = useState(service ? String(service.sessions_included) : "1");
  const [validity, setValidity] = useState(service?.validity_days ? String(service.validity_days) : "");
  const [perWeek, setPerWeek] = useState(service?.classes_per_week ? String(service.classes_per_week) : "2");
  const [stations, setStations] = useState<string[]>(service?.stations ?? []);
  const [showStations, setShowStations] = useState(service?.show_stations ?? true);
  const [active, setActive] = useState(service?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const monthly = billing === "monthly";
  const isPack = !monthly && Number(sessions) > 1;

  async function save() {
    if (!name.trim()) {
      setError("Poné un nombre.");
      return;
    }
    setBusy(true);
    setError(null);
    const common = {
      name: name.trim(),
      description: desc.trim() || null,
      price_ars: Number(price) || 0,
      duration_minutes: Number(dur) || 60,
      sessions_included: monthly ? 1 : Math.max(1, Number(sessions) || 1),
      validity_days: isPack && Number(validity) > 0 ? Number(validity) : null,
      stations,
      show_stations: showStations,
      active,
    };
    const { error } = service
      ? await supabase.from("services").update(common).eq("id", service.id)
      : await supabase.from("services").insert({
          ...common,
          sort_order: count,
          billing,
          classes_per_week: monthly ? Math.min(7, Math.max(1, Number(perWeek) || 1)) : null,
          sector_id: sector.id,
        });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onOpenChange(false);
    router.refresh();
  }

  return (
    <EditDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? service!.name : `Nuevo plan · ${sector.name}`}
      description={
        monthly
          ? "Abono: el cliente elige días, horario y cama fijos y paga cada mes. Si empieza a mitad de mes paga proporcional."
          : isPack
            ? "Pack: se compra una vez y el cliente agenda cada sesión con un crédito."
            : "1 sesión = plan individual. Poné más de 1 para crear un pack."
      }
      onSave={save}
      busy={busy}
      error={error}
      saveLabel={editing ? "Guardar" : "Crear plan"}
    >
      {!editing && (
        <Select value={billing} onValueChange={(v) => setBilling(v as "session" | "monthly")}>
          <SelectTrigger className="w-full" aria-label="Cobro">
            <SelectValue placeholder="Cobro" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="session">Por sesión (individual o pack)</SelectItem>
            <SelectItem value="monthly">Mensual (abono)</SelectItem>
          </SelectContent>
        </Select>
      )}
      <div>
        <Label htmlFor="svc-name" className="text-xs text-fg-muted">
          Nombre
        </Label>
        <Input
          id="svc-name"
          className="mt-1.5"
          placeholder={monthly ? "Ej. Pilates 2 veces por semana" : "Ej. Sesión individual"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <Label htmlFor="svc-price" className="text-xs text-fg-muted">
            {monthly ? "Precio por mes" : isPack ? "Precio del pack" : "Precio"}
          </Label>
          <Input
            id="svc-price"
            className="mt-1.5 font-mono"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            required
          />
        </div>
        <div>
          <Label htmlFor="svc-dur" className="text-xs text-fg-muted">
            Duración (min)
          </Label>
          <Input
            id="svc-dur"
            className="mt-1.5 font-mono"
            inputMode="numeric"
            value={dur}
            onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
            title={DURATION_HINT}
            required
          />
        </div>
        {monthly ? (
          <div>
            <Label htmlFor="svc-week" className="text-xs text-fg-muted">
              Clases por semana
            </Label>
            <Input
              id="svc-week"
              className="mt-1.5 font-mono"
              inputMode="numeric"
              value={perWeek}
              disabled={editing}
              title={editing ? "Para cambiarlas, creá otro plan." : undefined}
              onChange={(e) => setPerWeek(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
        ) : (
          <div>
            <Label htmlFor="svc-sessions" className="text-xs text-fg-muted">
              Sesiones
            </Label>
            <Input
              id="svc-sessions"
              className="mt-1.5 font-mono"
              inputMode="numeric"
              value={sessions}
              onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}
        {isPack && (
          <div>
            <Label htmlFor="svc-validity" className="text-xs text-fg-muted">
              Vence a los (días)
            </Label>
            <Input
              id="svc-validity"
              className="mt-1.5 font-mono"
              inputMode="numeric"
              placeholder="Nunca"
              value={validity}
              onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}
      </div>
      <p className="-mt-2 text-xs text-fg-faint">
        {DURATION_HINT}
        {monthly && editing && " El precio nuevo rige para las cuotas que se generen desde ahora."}
      </p>

      <StationsEditor value={stations} onChange={setStations} />
      {stations.length > 0 && (
        <Label className="-mt-1 gap-2.5 text-sm text-fg-muted">
          <Switch checked={showStations} onCheckedChange={setShowStations} />
          Mostrar como etiquetas en la web
        </Label>
      )}

      <div>
        <Label htmlFor="svc-desc" className="text-xs text-fg-muted">
          Descripción
        </Label>
        <Textarea
          id="svc-desc"
          className="mt-1.5"
          placeholder={stations.length ? "Corta: lo que incluye ya va en las etiquetas." : "Opcional"}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          rows={3}
        />
      </div>

      <Label className="gap-2.5 text-sm text-fg-muted">
        <Switch checked={active} onCheckedChange={setActive} />
        {sector.active ? "Visible en la web" : "Activo (visible solo para admins hasta lanzar el sector)"}
      </Label>
    </EditDialog>
  );
}
