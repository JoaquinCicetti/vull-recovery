"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Sector, Service } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

// A plan's duration is what the client reads on its card. The turno itself is
// one slot of the sector's grid (Disponibilidad); an abono class lasts this long.
const DURATION_HINT = "Solo informativo. Los turnos los define Disponibilidad.";

// A plan belongs to one sector for good: its turnos are filed under it, so the
// sector is chosen on creation and not editable afterwards. The same goes for
// how it is billed: per session (single or pack) or monthly (an abono of N
// fixed classes a week) — members' schedules are built on it.
export function ServicesManager({
  initial,
  sectors,
}: {
  initial: Service[];
  sectors: Sector[];
}) {
  const router = useRouter();
  const supabase = createClient();
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
  const [sectorId, setSectorId] = useState(sectors[0]?.id ?? "");

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const monthly = billing === "monthly";
    const n = monthly ? 1 : Math.max(1, Number(sessions) || 1);
    const weekly = Math.min(7, Math.max(1, Number(perWeek) || 1));
    const { error } = await supabase.from("services").insert({
      name,
      price_ars: Number(price) || 0,
      duration_minutes: Number(dur) || 60,
      description: desc || null,
      sort_order: initial.length,
      sessions_included: n,
      validity_days: !monthly && n > 1 && Number(validity) > 0 ? Number(validity) : null,
      billing,
      classes_per_week: monthly ? weekly : null,
      sector_id: sectorId,
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
    router.refresh();
  }

  const monthlyForm = billing === "monthly";
  const packForm = !monthlyForm && Number(sessions) > 1;

  return (
    <div className="flex flex-col gap-8">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent>
          <form onSubmit={addService}>
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
              Nuevo plan
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              {sectors.length > 1 && (
                <Select value={sectorId} onValueChange={setSectorId}>
                  <SelectTrigger className="w-full sm:w-fit" aria-label="Sector">
                    <SelectValue placeholder="Sector" />
                  </SelectTrigger>
                  <SelectContent>
                    {sectors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {!s.active && " (oculto)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select
                value={billing}
                onValueChange={(v) => setBilling(v as "session" | "monthly")}
              >
                <SelectTrigger className="w-full sm:w-fit" aria-label="Cobro">
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
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label className="text-xs text-fg-muted">
                    {monthlyForm
                      ? "Precio por mes (ARS)"
                      : packForm
                        ? "Precio del pack (ARS)"
                        : "Precio (ARS)"}
                  </Label>
                  <Input
                    className="mt-1.5 font-mono"
                    inputMode="numeric"
                    value={price}
                    onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-fg-muted">Duración por sesión (min)</Label>
                  <Input
                    className="mt-1.5 font-mono"
                    inputMode="numeric"
                    value={dur}
                    onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
                    required
                  />
                  <p className="mt-1 text-xs text-fg-faint">{DURATION_HINT}</p>
                </div>
                {monthlyForm ? (
                  <div className="w-28">
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
                  <div className="w-24">
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
              <p className="text-xs text-fg-faint">
                {monthlyForm
                  ? "Abono: el cliente elige días, horario y cama fijos y paga cada mes. Si empieza a mitad de mes paga proporcional."
                  : packForm
                    ? "Pack: se compra una vez y el cliente agenda cada sesión con un crédito."
                    : "1 sesión = plan individual. Poné más de 1 para crear un pack."}
              </p>
              <Button className="self-start" disabled={busy}>
                Agregar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {initial.map((s) => (
          <ServiceRow
            key={s.id}
            service={s}
            sector={sectors.length > 1 ? sectors.find((x) => x.id === s.sector_id) : undefined}
          />
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ServiceRow({ service, sector }: { service: Service; sector?: Sector }) {
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

  const isPack = !monthly && Number(sessions) > 1;

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

  async function remove() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("services").delete().eq("id", service.id);
    setBusy(false);
    if (error) {
      setError("No se puede eliminar (tiene turnos). Desactivalo en su lugar.");
      return;
    }
    router.refresh();
  }

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent>
        <div className="flex flex-col gap-3">
          {(sector || isPack || monthly) && (
            <div className="flex flex-wrap items-center gap-2">
              {sector && (
                <Badge variant="outline" className="font-mono text-xs text-fg-muted">
                  {sector.name}
                  {!sector.active && " · oculto"}
                </Badge>
              )}
              {isPack && (
                <p className="font-mono text-xs uppercase tracking-wider text-accent">
                  Pack · {sessions} sesiones
                </p>
              )}
              {monthly && (
                <p className="font-mono text-xs uppercase tracking-wider text-accent">
                  Mensual · {service.classes_per_week} {service.classes_per_week === 1 ? "clase" : "clases"}/sem
                </p>
              )}
            </div>
          )}
          <Input value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-3">
            <Input
              className="font-mono"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
            />
            <Input
              className="font-mono"
              inputMode="numeric"
              value={dur}
              onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
              aria-label="Duración (min)"
              title={DURATION_HINT}
            />
            {!monthly && (
              <Input
                className="w-24 font-mono"
                inputMode="numeric"
                value={sessions}
                onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))}
                aria-label="Sesiones"
              />
            )}
          </div>
          {isPack && (
            <div className="flex items-center gap-2">
              <Label htmlFor={`${service.id}-validity`} className="text-xs text-fg-muted">
                Vence a los (días)
              </Label>
              <Input
                id={`${service.id}-validity`}
                className="w-28 font-mono"
                inputMode="numeric"
                placeholder="Nunca"
                value={validity}
                onChange={(e) => setValidity(e.target.value.replace(/\D/g, ""))}
              />
            </div>
          )}
          {monthly && (
            <p className="text-xs text-fg-faint">
              El precio nuevo rige para las cuotas que se generen desde ahora. Para cambiar las
              clases por semana, creá otro plan.
            </p>
          )}
          <Label className="gap-2.5 text-fg-muted">
            <Switch checked={active} onCheckedChange={setActive} />
            {sector && !sector.active
              ? "Activo (visible solo para admins hasta lanzar el sector)"
              : "Activo (visible en la web)"}
          </Label>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              Guardar
            </Button>
            <Button variant="destructive" onClick={remove} disabled={busy}>
              Eliminar
            </Button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
