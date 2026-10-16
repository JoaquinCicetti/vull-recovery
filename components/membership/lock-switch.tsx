"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { dateLabel } from "@/lib/membership";
import { SettingRow } from "@/components/account/section";
import { Switch } from "@/components/ui/switch";

// "Reservar mi lugar todos los meses": keep the same schedule and beds every
// month (with the due-day rules) or let the abono end. Optimistic, rolled back
// when the server refuses (e.g. one of the beds is taken next month).
export function LockSwitch({
  membershipId,
  locked,
  dueDay,
  lateFeePct,
  releaseDay,
  endsOn,
}: {
  membershipId: string;
  locked: boolean;
  dueDay: number;
  lateFeePct: number;
  releaseDay: number;
  endsOn: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [on, setOn] = useState(locked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setOn(next);
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("membership", {
      body: { action: "set_locked", membership_id: membershipId, locked: next },
    });
    setBusy(false);
    if (err) {
      setOn(!next);
      setError(await readError(err, "No se pudo cambiar. Probá de nuevo."));
      return;
    }
    router.refresh();
  }

  return (
    <>
      <SettingRow
        htmlFor="plan-lock"
        label="Reservar mi lugar todos los meses"
        help={
          on
            ? `Tus horarios y cama quedan fijos. Pagás hasta el ${dueDay} de cada mes; después +${lateFeePct} %, y si no está paga al ${releaseDay} el lugar se puede liberar.`
            : endsOn
              ? `Tu abono termina el ${dateLabel(endsOn)}. Para seguir, volvés a elegir horarios.`
              : "Tu abono termina con el mes."
        }
        control={
          <Switch
            id="plan-lock"
            checked={on}
            disabled={busy}
            onCheckedChange={toggle}
          />
        }
      />
      {error && (
        <p role="alert" className="px-5 pb-4 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
