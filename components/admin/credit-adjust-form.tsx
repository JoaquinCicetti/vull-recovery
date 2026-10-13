"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FIELD } from "@/components/admin/stat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Add or remove sessions from a client's balance (a comp, a correction).
// Goes through admin_adjust_credit(), which re-checks is_admin server-side,
// clamps a removal at zero and writes the ledger row.
export function CreditAdjustForm({
  userId,
  services,
}: {
  userId: string;
  services: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [amount, setAmount] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply(sign: 1 | -1) {
    const n = Number.parseInt(amount, 10);
    if (!serviceId || !Number.isFinite(n) || n <= 0) {
      setMsg({ ok: false, text: "Indicá el plan y una cantidad mayor a 0." });
      return;
    }
    setBusy(true);
    setMsg(null);
    const { data, error } = await supabase.rpc("admin_adjust_credit", {
      p_user: userId,
      p_service: serviceId,
      p_delta: sign * n,
      p_note: note,
    });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: error.message });
      return;
    }
    const applied = Number(data ?? 0);
    setMsg(
      applied === 0
        ? { ok: false, text: "No había saldo para quitar." }
        : {
            ok: true,
            text: `${applied > 0 ? "Sumadas" : "Quitadas"} ${Math.abs(applied)} ${
              Math.abs(applied) === 1 ? "sesión" : "sesiones"
            }.`,
          },
    );
    setNote("");
    router.refresh();
  }

  if (services.length === 0) {
    return <p className="text-sm text-fg-faint">No hay planes cargados.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="min-w-40 flex-1">
          <Label className="text-xs text-fg-muted">Plan</Label>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className={`${FIELD} mt-1.5 w-full`}
          >
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="w-24">
          <Label className="text-xs text-fg-muted">Sesiones</Label>
          <Input
            className="mt-1.5 font-mono"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </div>
      </div>
      <div>
        <Label className="text-xs text-fg-muted">Motivo (queda en el historial)</Label>
        <Input
          className="mt-1.5"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ej. cortesía, pago en efectivo, corrección"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => apply(1)} disabled={busy}>
          Sumar
        </Button>
        <Button variant="destructive" onClick={() => apply(-1)} disabled={busy}>
          Quitar
        </Button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-accent" : "text-danger"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}
