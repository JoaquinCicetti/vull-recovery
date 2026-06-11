"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function ServicesManager({ initial }: { initial: Service[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [dur, setDur] = useState("60");
  const [desc, setDesc] = useState("");

  async function addService(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("services").insert({
      name,
      price_ars: Number(price) || 0,
      duration_minutes: Number(dur) || 60,
      description: desc || null,
      sort_order: initial.length,
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
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <Card className="[--card-spacing:--spacing(5)]">
        <CardContent>
          <form onSubmit={addService}>
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
              Nuevo plan
            </h2>
            <div className="mt-4 flex flex-col gap-3">
              <Input
                placeholder="Nombre (ej. Sesión individual)"
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
                <Input
                  className="font-mono"
                  placeholder="Precio ARS"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
                  required
                />
                <Input
                  className="font-mono"
                  placeholder="Duración (min)"
                  inputMode="numeric"
                  value={dur}
                  onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
              <Button className="self-start" disabled={busy}>
                Agregar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {initial.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ServiceRow({ service }: { service: Service }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState(service.name);
  const [price, setPrice] = useState(String(service.price_ars));
  const [dur, setDur] = useState(String(service.duration_minutes));
  const [active, setActive] = useState(service.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from("services")
      .update({
        name,
        price_ars: Number(price) || 0,
        duration_minutes: Number(dur) || 60,
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
    const { error } = await supabase
      .from("services")
      .delete()
      .eq("id", service.id);
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
            />
          </div>
          <Label className="gap-2.5 text-fg-muted">
            <Switch checked={active} onCheckedChange={setActive} />
            Activo (visible en la web)
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
