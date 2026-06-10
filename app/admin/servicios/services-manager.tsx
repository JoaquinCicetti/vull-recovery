"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Service } from "@/lib/types";

const dangerBtn =
  "inline-flex items-center justify-center rounded-md border border-danger/40 px-4 py-2.5 text-sm font-semibold text-danger transition-colors duration-150 hover:bg-danger/10 disabled:opacity-50";

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
    <div className="mt-8 flex flex-col gap-8">
      <form onSubmit={addService} className="surface-card p-5">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
          Nuevo plan
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <input
            className="field"
            placeholder="Nombre (ej. Sesión individual)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <textarea
            className="field"
            placeholder="Descripción (opcional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
          />
          <div className="flex gap-3">
            <input
              className="field font-mono"
              placeholder="Precio ARS"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
              required
            />
            <input
              className="field font-mono"
              placeholder="Duración (min)"
              inputMode="numeric"
              value={dur}
              onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
              required
            />
          </div>
          <button className="btn-primary self-start" disabled={busy}>
            Agregar
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        {initial.map((s) => (
          <ServiceRow key={s.id} service={s} dangerBtn={dangerBtn} />
        ))}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function ServiceRow({
  service,
  dangerBtn,
}: {
  service: Service;
  dangerBtn: string;
}) {
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
    <div className="surface-card p-5">
      <div className="flex flex-col gap-3">
        <input
          className="field"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex gap-3">
          <input
            className="field font-mono"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))}
          />
          <input
            className="field font-mono"
            inputMode="numeric"
            value={dur}
            onChange={(e) => setDur(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            className="accent-accent"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Activo (visible en la web)
        </label>
        <div className="flex gap-2">
          <button onClick={save} disabled={busy} className="btn-primary">
            Guardar
          </button>
          <button onClick={remove} disabled={busy} className={dangerBtn}>
            Eliminar
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
