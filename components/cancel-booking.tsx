"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

async function readError(error: unknown): Promise<string> {
  try {
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json();
      if (body?.error) return body.error as string;
    }
  } catch {
    /* ignore */
  }
  return "No se pudo cancelar. Probá de nuevo.";
}

type Size = "sm" | "default" | "lg";

/**
 * Inline cancel control with a two-step confirm (no modal). Calls the
 * `cancel-booking` Edge Function, which authorizes owner-or-admin server-side.
 * Used on the client's turno page and in the admin schedule.
 */
export function CancelBooking({
  bookingId,
  label = "Cancelar turno",
  confirmPrompt = "¿Seguro que querés cancelar este turno?",
  confirmLabel = "Sí, cancelar",
  size = "sm",
  className,
  onDone,
}: {
  bookingId: string;
  label?: string;
  confirmPrompt?: string;
  confirmLabel?: string;
  size?: Size;
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.functions.invoke("cancel-booking", {
      body: { booking_id: bookingId },
    });
    setLoading(false);
    if (error) {
      setError(await readError(error));
      return;
    }
    setConfirming(false);
    onDone?.();
    router.refresh();
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size={size}
        className={cn("font-normal text-fg-faint hover:text-danger", className)}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-sm text-fg-muted">{confirmPrompt}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          size={size}
          onClick={cancel}
          disabled={loading}
        >
          {loading ? "Cancelando…" : confirmLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size={size}
          className="font-normal text-fg-faint"
          onClick={() => setConfirming(false)}
          disabled={loading}
        >
          No, volver
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
