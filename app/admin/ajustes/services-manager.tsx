"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Sector, Service } from "@/lib/types";
import { formatARS } from "@/lib/site";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

// The plans of ONE sector: a list with inline edit, and "Nuevo plan" in a
// dialog. A plan belongs to its sector for good (its turnos are filed under
// it), and so does how it is billed: per session (single or pack) or monthly
// (an abono of N fixed classes a week) — members' schedules are built on it.
export function ServicesManager({ initial, sector }: { initial: Service[]; sector: Sector }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <NewServiceDialog sector={sector} count={initial.length} />
      </div>
      {initial.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
          {sector.name} no tiene planes todavía.
        </p>
      ) : (
        <ul className="surface-card divide-y divide-border">
          {initial.map((s) => (
            <ServiceRow key={s.id} service={s} sector={sector} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewServiceDialog({ sector, count }: { sector: Sector; count: number }) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [dur, setDur] = useState("60");
  const [desc, setDesc] = useState("");
  const [sessions, setSessions] = useState("1"); // >1 = pack
  const [validity, setValidity] = useState(""); // pack: days, empty = never
  const [billing, setBilling] = useState<"session" | "monthly">("session");
  const [perWeek, setPerWeek] = useState("2");

  const monthlyForm = billing === "monthly";
  const packForm = !monthlyForm && Number(sessions) > 1;

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const n = monthlyForm ? 1 : Math.max(1, Number(sessions) || 1);
    const weekly = Math.min(7, Math.max(1, Number(perWeek) || 1));
    const { error } = await supabase.from("services").insert({
      name,
      price_ars: Number(price) || 0,
      duration_minutes: Number(dur) || 60,
      description: desc || null,
      sort_order: count,
      sessions_included: n,
      validity_days: !monthlyForm && n > 1 && Number(validity) > 0 ? Number(validity) : null,
      billing,
      classes_per_week: monthlyForm ? weekly : null,
      sector_id: sector.id,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setName("");
    setPrice("");
    setDur("60");
    setDesc("");
    setSessions("1");
    setValidity("");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden />
          Nuevo plan
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo plan · {sector.name}</DialogTitle>
          <DialogDescription>
            {monthlyForm
              ? "Abono: el cliente elige días, horario y cama fijos y paga cada mes. Si empieza a mitad de mes paga proporcional."
              : packForm
                ? "Pack: se compra una vez y el cliente agenda cada sesión con un crédito."
                : "1 sesión = plan individual. Poné más de 1 para crear un pack."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={addService} className="flex flex-col gap-3">
          <Select value={billing} onValueChange={(v) => setBilling(v as "session" | "monthly")}>
            <SelectTrigger className="w-full" aria-label="Cobro">
              <SelectValue placeholder="Cobro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="session">Por sesión (individual o pack)</SelectItem>
              <SelectItem value="monthly">Mensual (abono)</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={monthlyForm ? "Nombre (ej. Pilates 2 veces por semana)" : "Nombre (ej. Sesión individual)"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Textarea
            placeholder="Descripción (opcional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs text-fg-muted">
                {monthlyForm ? "Precio por mes" : packForm ? "Precio del pack" : "Precio"}
              </Label>
              <Input
                className="mt-1.5 font-mono"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <div>
              <Label className="text-xs text-fg-muted">Duración (min)</Label>
              <Input
                className="mt-1.5 font-mono"
                inputMode="numeric"
                value={dur}
                onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            {monthlyForm ? (
              <div>
                <Label className="text-xs text-fg-muted">Clases por semana</Label>
                <Input
                  className="mt-1.5 font-mono"
                  inputMode="numeric"
                  value={perWeek}
                  onChange={(e) => setPerWeek(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
            ) : (
              <div>
                <Label className="text-xs text-fg-muted">Sesiones</Label>
                <Input
                  className="mt-1.5 font-mono"
                  inputMode="numeric"
                  value={sessions}
                  onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            )}
          </div>
          <p className="text-xs text-fg-faint">{DURATION_HINT}</p>
          {packForm && (
            <div className="w-40">
              <Label className="text-xs text-fg-muted">Vence a los (días)</Label>
              <Input
                className="mt-1.5 font-mono"
                inputMode="numeric"
                placeholder="Sin vencimiento"
                value={validity}
                onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <Button disabled={busy}>{busy ? "Creando…" : "Crear plan"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// One plan: name, price, duration, sessions and its switch, saved in place.
// Delete asks first and fails softly when the plan has turnos.
function ServiceRow({ service, sector }: { service: Service; sector: Sector }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(service.name);
  const [price, setPrice] = useState(String(service.price_ars));
  const [dur, setDur] = useState(String(service.duration_minutes));
  const [sessions, setSessions] = useState(String(service.sessions_included));
  const [validity, setValidity] = useState(service.validity_days ? String(service.validity_days) : "");
  const [active, setActive] = useState(service.active);
  const monthly = service.billing === "monthly";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isPack = !monthly && Number(sessions) > 1;
  const dirty =
    name !== service.name ||
    price !== String(service.price_ars) ||
    dur !== String(service.duration_minutes) ||
    sessions !== String(service.sessions_included) ||
    validity !== (service.validity_days ? String(service.validity_days) : "") ||
    active !== service.active;

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("services")
      .update({
        name,
        price_ars: Number(price) || 0,
        duration_minutes: Number(dur) || 60,
        sessions_included: monthly ? 1 : Math.max(1, Number(sessions) || 1),
        validity_days: isPack && Number(validity) > 0 ? Number(validity) : null,
        active,
      })
      .eq("id", service.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  async function remove(): Promise<string | null> {
    const { error } = await supabase.from("services").delete().eq("id", service.id);
    if (error) return "No se puede eliminar: tiene turnos. Desactivalo en su lugar.";
    router.refresh();
    return null;
  }

  return (
    <li className={cn("flex flex-col gap-3 px-4 py-4", !active && "opacity-70")}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
          {monthly
            ? `Mensual · ${service.classes_per_week} ${service.classes_per_week === 1 ? "clase" : "clases"}/sem`
            : isPack
              ? `Pack · ${sessions} sesiones`
              : "Sesión"}
        </p>
        <span className="font-mono text-xs text-fg-faint">
          {formatARS(service.price_ars)}
          {monthly && " / mes"}
        </span>
      </div>
      <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre" />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor={`${service.id}-price`} className="text-xs text-fg-muted">
            Precio
          </Label>
          <Input
            id={`${service.id}-price`}
            className="mt-1.5 font-mono"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div>
          <Label htmlFor={`${service.id}-dur`} className="text-xs text-fg-muted">
            Minutos
          </Label>
          <Input
            id={`${service.id}-dur`}
            className="mt-1.5 font-mono"
            inputMode="numeric"
            value={dur}
            onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
            title={DURATION_HINT}
          />
        </div>
        {!monthly && (
          <div>
            <Label htmlFor={`${service.id}-sessions`} className="text-xs text-fg-muted">
              Sesiones
            </Label>
            <Input
              id={`${service.id}-sessions`}
              className="mt-1.5 font-mono"
              inputMode="numeric"
              value={sessions}
              onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}
        {isPack && (
          <div>
            <Label htmlFor={`${service.id}-validity`} className="text-xs text-fg-muted">
              Vence (días)
            </Label>
            <Input
              id={`${service.id}-validity`}
              className="mt-1.5 font-mono"
              inputMode="numeric"
              placeholder="Nunca"
              value={validity}
              onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))}
            />
          </div>
        )}
      </div>
      {monthly && (
        <p className="text-xs text-fg-faint">
          El precio nuevo rige para las cuotas que se generen desde ahora. Para cambiar las
          clases por semana, creá otro plan.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label className="gap-2.5 text-fg-muted">
          <Switch checked={active} onCheckedChange={setActive} />
          {sector.active ? "Visible en la web" : "Activo (visible solo para admins hasta lanzar el sector)"}
        </Label>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-fg-faint hover:text-danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            Eliminar
          </Button>
          <Button size="sm" onClick={save} disabled={busy || !dirty}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Eliminar el plan"
        description={
          <>
            «{service.name}» desaparece de la web y del panel. Solo se puede eliminar un plan
            sin turnos; si ya tiene, desactivalo.
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
