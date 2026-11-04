"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatARS } from "@/lib/site";
import { fmtDate } from "@/lib/format";
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

export type CouponRow = {
  id: string;
  code: string;
  percent: number;
  active: boolean;
  created_at: string;
  uses: number;
  discounted_ars: number;
};

type CouponUse = {
  payment_id: string;
  client_name: string | null;
  service_name: string | null;
  created_at: string;
  amount_ars: number;
  list_amount_ars: number;
};

// Discount codes (ADR 0016). They apply to any sector's turnos and packs, so this
// lives outside the sector switch. A code and its percent are fixed once created:
// the only change is turning it off, which leaves transfers already generated
// at their price. A "use" is a payment that went through with the code.
export function CouponsManager({ initial }: { initial: CouponRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <NewCouponDialog />
      </div>
      {initial.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-fg-faint">
          Todavía no hay cupones.
        </p>
      ) : (
        <ul className="surface-card divide-y divide-border">
          {initial.map((c) => (
            <CouponItem key={c.id} coupon={c} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewCouponDialog() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(percent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
      setError("El descuento va de 1 a 99 %.");
      return;
    }
    if (code.length < 3) {
      setError("El código necesita al menos 3 caracteres.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("coupons").insert({ code, percent: pct });
    setBusy(false);
    if (error) {
      setError(error.code === "23505" ? "Ya existe un cupón con ese código." : error.message);
      return;
    }
    setCode("");
    setPercent("");
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden />
          Nuevo cupón
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo cupón</DialogTitle>
          <DialogDescription>
            Vale para turnos y packs de todos los sectores, sin límite de usos. El código y
            el descuento no se pueden cambiar después; lo que sí podés es desactivarlo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="flex flex-col gap-3">
          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <div>
              <Label htmlFor="coupon-code" className="text-xs text-fg-muted">
                Código
              </Label>
              <Input
                id="coupon-code"
                className="mt-1.5 font-mono uppercase"
                value={code}
                maxLength={32}
                autoComplete="off"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
                required
              />
            </div>
            <div>
              <Label htmlFor="coupon-percent" className="text-xs text-fg-muted">
                Descuento %
              </Label>
              <Input
                id="coupon-percent"
                className="mt-1.5 font-mono"
                inputMode="numeric"
                value={percent}
                onChange={(e) => setPercent(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-2 flex justify-end">
            <Button disabled={busy}>{busy ? "Creando…" : "Crear cupón"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CouponItem({ coupon }: { coupon: CouponRow }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setActive(active: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from("coupons").update({ active }).eq("id", coupon.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.refresh();
  }

  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={coupon.active ? "text-fg" : "text-fg-faint"}>
            <span className="break-all font-mono font-medium">{coupon.code}</span>
            <span className="ml-2 font-mono text-sm text-fg-muted">−{coupon.percent}%</span>
          </p>
          <p className="mt-0.5 text-xs text-fg-faint">
            <span className="font-mono">{coupon.uses}</span>{" "}
            {coupon.uses === 1 ? "uso" : "usos"}
            {coupon.uses > 0 && (
              <>
                {" · "}
                <span className="font-mono">{formatARS(coupon.discounted_ars)}</span> descontados
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {coupon.uses > 0 && <UsesDialog coupon={coupon} />}
          <Switch
            checked={coupon.active}
            disabled={busy}
            onCheckedChange={setActive}
            aria-label={`Cupón ${coupon.code} activo`}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

// Loaded on open: most visits to Ajustes never look at this.
function UsesDialog({ coupon }: { coupon: CouponRow }) {
  const supabase = createClient();
  const [uses, setUses] = useState<CouponUse[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(open: boolean) {
    if (!open) return;
    setError(null);
    const { data, error } = await supabase.rpc("admin_coupon_uses", { p_coupon_id: coupon.id });
    if (error) setError(error.message);
    else setUses((data ?? []) as CouponUse[]);
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Ver usos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">{coupon.code}</DialogTitle>
          <DialogDescription>Pagos acreditados con este código (últimos 200).</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : !uses ? (
          <p className="text-sm text-fg-faint">Cargando…</p>
        ) : uses.length === 0 ? (
          <p className="text-sm text-fg-faint">Sin usos.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {uses.map((u) => (
              <li key={u.payment_id} className="flex items-start justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="text-fg">{u.client_name || "Sin nombre"}</p>
                  <p className="text-xs text-fg-faint">
                    {u.service_name ?? "Servicio"} · {fmtDate(u.created_at)}
                  </p>
                </div>
                <div className="shrink-0 text-right font-mono">
                  <p className="text-fg">{formatARS(u.amount_ars)}</p>
                  <p className="text-xs text-fg-faint line-through">
                    {formatARS(u.list_amount_ars)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
