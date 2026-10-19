"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Lock, LockOpen, MoreHorizontal, XCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";

// Admin actions on one abono behind a menu: collect a cuota in cash, switch
// renewal on/off, free the slots. Each one asks first; releasing is red.
export function MembershipActions({
  membershipId,
  pendingPeriodId,
  locked,
  active,
}: {
  membershipId: string;
  pendingPeriodId: string | null;
  locked: boolean;
  active: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [dialog, setDialog] = useState<"paid" | "lock" | "release" | null>(null);

  async function act(body: Record<string, unknown>): Promise<string | null> {
    const { error: err } = await supabase.functions.invoke("admin-membership", { body });
    if (err) return readError(err, "No se pudo completar.");
    router.refresh();
    return null;
  }

  if (!active) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Acciones del abono">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {pendingPeriodId && (
            <DropdownMenuItem onSelect={() => setDialog("paid")}>
              <Banknote className="text-accent" />
              Cobré la cuota en efectivo
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("lock")}>
            {locked ? <LockOpen /> : <Lock />}
            {locked ? "Quitar horario fijo" : "Hacer horario fijo"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog("release")}>
            <XCircle />
            Liberar lugar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === "paid"}
        onOpenChange={(o) => setDialog(o ? "paid" : null)}
        title="Registrar la cuota"
        description="La cuota pendiente queda pagada en efectivo y las clases del mes, confirmadas. El cliente recibe el aviso."
        confirmLabel="Sí, cobrada"
        busyLabel="Registrando…"
        onConfirm={() => act({ action: "mark_paid", period_id: pendingPeriodId })}
      />
      <ConfirmDialog
        open={dialog === "lock"}
        onOpenChange={(o) => setDialog(o ? "lock" : null)}
        title={locked ? "Quitar el horario fijo" : "Hacer el horario fijo"}
        description={
          locked
            ? "El abono deja de renovarse solo: termina con el último mes pago y el lugar queda libre después."
            : "El abono se renueva cada mes con los mismos días, horario y cama, mientras la cuota esté al día."
        }
        confirmLabel={locked ? "Sí, quitar" : "Sí, fijar"}
        onConfirm={() => act({ action: "set_locked", membership_id: membershipId, locked: !locked })}
      />
      <ConfirmDialog
        open={dialog === "release"}
        onOpenChange={(o) => setDialog(o ? "release" : null)}
        title="Liberar el lugar"
        description="Se cancelan las clases posteriores al último mes pago y el horario queda libre para otra persona. Esto no se puede deshacer."
        confirmLabel="Sí, liberar"
        busyLabel="Liberando…"
        tone="danger"
        onConfirm={() => act({ action: "release", membership_id: membershipId })}
      />
    </>
  );
}
