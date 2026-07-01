"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { ReschedulePanel } from "@/components/admin/reschedule-panel";
import type { BookingStatus } from "@/lib/types";

async function readError(error: unknown, fallback: string): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

type Action = "confirm" | "no_show" | "cancel";

const META: Record<
  Action,
  { label: string; prompt: string; confirmLabel: string; busy: string; destructive: boolean }
> = {
  confirm: {
    label: "Confirmar",
    prompt: "¿Confirmar este turno manualmente (pago recibido)?",
    confirmLabel: "Sí, confirmar",
    busy: "Confirmando…",
    destructive: false,
  },
  no_show: {
    label: "No asistió",
    prompt: "¿Marcar que el cliente no asistió?",
    confirmLabel: "Sí, no asistió",
    busy: "Guardando…",
    destructive: true,
  },
  cancel: {
    label: "Cancelar",
    prompt: "¿Cancelar el turno de este cliente?",
    confirmLabel: "Sí, cancelar",
    busy: "Cancelando…",
    destructive: true,
  },
};

/**
 * Admin per-turno actions with inline two-step confirms (no modal). confirm /
 * no_show / reschedule go through the is_admin-gated `admin-booking` function;
 * cancel uses `cancel-booking`. Available actions depend on status/timing.
 */
export function BookingActions({
  bookingId,
  serviceId,
  status,
  started,
}: {
  bookingId: string;
  serviceId: string;
  status: BookingStatus;
  started: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [pending, setPending] = useState<Action | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = ["pending", "awaiting_payment", "confirmed"].includes(status);
  const available: Action[] = [];
  if (status === "pending" || status === "awaiting_payment") available.push("confirm");
  if (status === "confirmed" && started) available.push("no_show");
  if (isActive) available.push("cancel");
  const canReschedule = isActive && !started;

  if (available.length === 0 && !canReschedule) return null;

  async function run(action: Action) {
    setLoading(true);
    setError(null);
    const fn = action === "cancel" ? "cancel-booking" : "admin-booking";
    const body =
      action === "cancel"
        ? { booking_id: bookingId }
        : { booking_id: bookingId, action };
    const { error } = await supabase.functions.invoke(fn, { body });
    setLoading(false);
    if (error) {
      setError(await readError(error, "No se pudo completar la acción."));
      return;
    }
    setPending(null);
    router.refresh();
  }

  if (rescheduling) {
    return (
      <div className="flex flex-col items-end gap-2">
        <ReschedulePanel
          bookingId={bookingId}
          serviceId={serviceId}
          onDone={() => {
            setRescheduling(false);
            router.refresh();
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="font-normal text-fg-faint"
          onClick={() => setRescheduling(false)}
        >
          Volver
        </Button>
      </div>
    );
  }

  if (pending) {
    const m = META[pending];
    return (
      <div className="flex flex-col items-end gap-2">
        <p className="text-sm text-fg-muted">{m.prompt}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant={m.destructive ? "destructive" : "default"}
            size="sm"
            onClick={() => run(pending)}
            disabled={loading}
          >
            {loading ? m.busy : m.confirmLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-normal text-fg-faint"
            onClick={() => setPending(null)}
            disabled={loading}
          >
            Volver
          </Button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap justify-end gap-2">
        {available.map((a) => (
          <Button
            key={a}
            type="button"
            variant="ghost"
            size="sm"
            className={
              META[a].destructive
                ? "font-normal text-fg-faint hover:text-danger"
                : "font-normal text-accent hover:text-accent-hover"
            }
            onClick={() => {
              setError(null);
              setPending(a);
            }}
          >
            {META[a].label}
          </Button>
        ))}
        {canReschedule && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-normal text-fg-muted hover:text-fg"
            onClick={() => {
              setError(null);
              setRescheduling(true);
            }}
          >
            Reprogramar
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
