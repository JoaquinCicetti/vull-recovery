"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { formatARS } from "@/lib/site";
import { quoteFirstPeriod, type MembershipAvailability, type SchedulePick } from "@/lib/membership";
import type { Service } from "@/lib/types";
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
import { WeeklySchedulePicker } from "@/components/membership/weekly-schedule-picker";

type Found = { id: string; full_name: string | null; whatsapp_phone: string | null } | null;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A schedule sold at the desk. The client may not have an account: one is
// created with their email (they sign in later with the usual code) and they
// are emailed. "Cobrado en efectivo" records the first cuota as paid.
export function NewMembershipForm({
  plans,
  today,
  maxStart,
  initialEmail = "",
}: {
  plans: Service[];
  today: string;
  /** Latest start: the 1st of next month. */
  maxStart: string;
  initialEmail?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState(initialEmail);
  const [found, setFound] = useState<Found | undefined>(undefined); // undefined = not looked up
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState(today);
  const [locked, setLocked] = useState(true);
  const [cash, setCash] = useState(true);
  const [picks, setPicks] = useState<SchedulePick[]>([]);
  const [avail, setAvail] = useState<MembershipAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; userId: string; created: boolean; cash: boolean } | null>(null);

  const plan = plans.find((p) => p.id === planId);
  const n = plan?.classes_per_week ?? 1;

  async function lookup() {
    const e = email.trim().toLowerCase();
    if (!EMAIL.test(e)) {
      setError("Email inválido");
      return;
    }
    setError(null);
    const { data } = await supabase.rpc("admin_user_list", {
      p_search: e,
      p_only_balance: false,
      p_sort: "recent",
      p_limit: 5,
      p_offset: 0,
    });
    const hit = ((data ?? []) as { id: string; email: string | null; full_name: string | null; whatsapp_phone: string | null }[])
      .find((u) => (u.email ?? "").toLowerCase() === e);
    setFound(hit ? { id: hit.id, full_name: hit.full_name, whatsapp_phone: hit.whatsapp_phone } : null);
    setName(hit?.full_name ?? "");
    setPhone(hit?.whatsapp_phone ?? "");
  }

  async function submit() {
    if (!plan || picks.length !== n) return;
    if (found === null && !name.trim()) {
      setError("Poné el nombre del cliente.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("admin-membership", {
      body: {
        action: "create_for_client",
        email: email.trim().toLowerCase(),
        full_name: name.trim() || null,
        whatsapp_phone: phone.trim() || null,
        service_id: plan.id,
        slots: picks,
        locked,
        starts_on: startsOn,
        paid_cash: cash,
      },
    });
    setBusy(false);
    if (err || !data?.membership) {
      setError(await readError(err, "No se pudo crear el abono."));
      return;
    }
    setDone({
      name: name.trim() || found?.full_name || email,
      userId: data.user.id,
      created: data.user.created,
      cash,
    });
    setPicks([]);
    router.refresh();
  }

  if (plans.length === 0) {
    return (
      <p className="text-sm text-fg-faint">
        No hay planes mensuales. Creá uno en Planes con cobro &quot;Mensual&quot;.
      </p>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-semibold text-fg">Abono creado para {done.name} ✓</p>
        <p className="text-sm text-fg-muted">
          {done.cash ? "La cuota quedó registrada como pagada en efectivo." : "La cuota queda pendiente: el cliente la paga desde Mi abono, o la marcás cuando cobres."}{" "}
          {done.created
            ? "Le creamos la cuenta y le mandamos un email para que entre con su email."
            : "Le mandamos un email con su horario."}
        </p>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={`/admin/clientes/${done.userId}`}>Ver cliente</Link>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setDone(null);
              setEmail("");
              setFound(undefined);
            }}
          >
            Otro abono
          </Button>
        </div>
      </div>
    );
  }

  const quote = avail ? quoteFirstPeriod(avail, picks.map((p) => p.weekday)) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="na-email">Email del cliente</Label>
        <div className="flex gap-2">
          <Input
            id="na-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setFound(undefined);
            }}
            onBlur={() => email && found === undefined && lookup()}
            placeholder="cliente@email.com"
          />
          <Button type="button" variant="outline" onClick={lookup}>
            Buscar
          </Button>
        </div>
        {found && (
          <p className="text-sm text-fg-muted">
            Cliente existente: <span className="font-medium text-fg">{found.full_name ?? email}</span>
            {found.whatsapp_phone && ` · ${found.whatsapp_phone}`} ·{" "}
            <Link href={`/admin/clientes/${found.id}`} className="text-accent hover:underline">
              ver
            </Link>
          </p>
        )}
        {found === null && (
          <p className="text-sm text-fg-muted">
            No existe una cuenta con ese email. La creamos y le mandamos un email para entrar.
          </p>
        )}
      </div>

      {found === null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="na-name">Nombre y apellido</Label>
            <Input id="na-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="na-phone">WhatsApp</Label>
            <Input
              id="na-phone"
              className="font-mono"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
      )}

      {found !== undefined && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>Plan</Label>
              <Select
                value={planId}
                onValueChange={(v) => {
                  setPlanId(v);
                  setPicks([]);
                }}
              >
                <SelectTrigger className="w-full sm:w-fit" aria-label="Plan">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {formatARS(p.price_ars)}/mes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="na-start">Empieza</Label>
              <Input
                id="na-start"
                type="date"
                className="w-fit font-mono"
                min={today}
                max={maxStart}
                value={startsOn}
                onChange={(e) => e.target.value && setStartsOn(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <Label className="gap-2.5 text-fg-muted">
              <Switch checked={locked} onCheckedChange={setLocked} />
              Horario fijo todos los meses
            </Label>
            <Label className="gap-2.5 text-fg-muted">
              <Switch checked={cash} onCheckedChange={setCash} />
              Cobrado en efectivo
            </Label>
          </div>

          {plan && (
            <WeeklySchedulePicker
              key={plan.id}
              serviceId={plan.id}
              startsOn={startsOn}
              locked={locked}
              classesPerWeek={n}
              value={picks}
              onChange={setPicks}
              onData={setAvail}
              adminMode
            />
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy || picks.length !== n} onClick={submit}>
              {busy ? "Creando…" : picks.length !== n ? `Elegí ${n - picks.length} día(s) más` : "Crear abono"}
            </Button>
            {quote && picks.length === n && (
              <span className="text-sm text-fg-muted">
                Primera cuota ≈ <span className="font-mono text-fg">{formatARS(quote.amount)}</span> (
                {quote.classes} {quote.classes === 1 ? "clase" : "clases"})
              </span>
            )}
          </div>
        </>
      )}
      {found === undefined && error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
