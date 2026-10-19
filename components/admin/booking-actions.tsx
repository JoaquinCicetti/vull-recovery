"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BanknoteArrowDown,
  CalendarClock,
  ExternalLink,
  MoreHorizontal,
  UserX,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { ReschedulePanel } from "@/components/admin/reschedule-panel";
import type { BookingStatus } from "@/lib/types";

type Action = "paid" | "no_show" | "cancel";

/**
 * Admin per-turno actions behind one menu, each with its own question before
 * it runs. "Marcar pagado" is the only positive one (a turno is confirmed BY
 * paying: there is no confirm without a payment). Cancel is red and says what
 * the client loses; reschedule warns before the slot picker opens.
 * paid / no_show / reschedule go through the is_admin-gated `admin-booking`
 * function; cancel uses `cancel-booking`.
 */
export function BookingActions({
  bookingId,
  serviceId,
  status,
  started,
  membership = false,
  summary,
}: {
  bookingId: string;
  serviceId: string;
  status: BookingStatus;
  started: boolean;
  /** An abono class: paid with the month's cuota, never one by one. */
  membership?: boolean;
  /** "Lun 20 oct · 10:00 · Juan Pérez": names the turno inside each dialog. */
  summary: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [dialog, setDialog] = useState<Action | "reschedule" | null>(null);

  const isActive = ["pending", "awaiting_payment", "confirmed"].includes(status);
  const canPay = (status === "pending" || status === "awaiting_payment") && !membership;
  const canNoShow = status === "confirmed" && started;
  const canReschedule = isActive && !started;
  const canCancel = isActive;

  async function run(action: Action): Promise<string | null> {
    const fn = action === "cancel" ? "cancel-booking" : "admin-booking";
    const body =
      action === "cancel"
        ? { booking_id: bookingId }
        : { booking_id: bookingId, action: action === "paid" ? "confirm" : action };
    const { error } = await supabase.functions.invoke(fn, { body });
    if (error) return readError(error, "No se pudo completar la acción.");
    router.refresh();
    return null;
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Acciones: ${summary}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/turno/${bookingId}`}>
              <ExternalLink />
              Ver turno
            </Link>
          </DropdownMenuItem>
          {canPay && (
            <DropdownMenuItem onSelect={() => setDialog("paid")}>
              <BanknoteArrowDown className="text-accent" />
              Marcar pagado
            </DropdownMenuItem>
          )}
          {canReschedule && (
            <DropdownMenuItem onSelect={() => setDialog("reschedule")}>
              <CalendarClock />
              Reprogramar
            </DropdownMenuItem>
          )}
          {canNoShow && (
            <DropdownMenuItem onSelect={() => setDialog("no_show")}>
              <UserX />
              No asistió
            </DropdownMenuItem>
          )}
          {canCancel && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("cancel")}>
                <XCircle />
                Cancelar turno
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={dialog === "paid"}
        onOpenChange={(o) => setDialog(o ? "paid" : null)}
        title="Registrar el pago"
        description={
          <>
            {summary}. El turno queda <strong className="text-fg">confirmado</strong> y el
            cliente recibe el aviso. Usalo cuando cobraste en efectivo o viste la
            transferencia.
          </>
        }
        confirmLabel="Sí, cobrado"
        busyLabel="Registrando…"
        onConfirm={() => run("paid")}
      />

      <ConfirmDialog
        open={dialog === "no_show"}
        onOpenChange={(o) => setDialog(o ? "no_show" : null)}
        title="Marcar ausencia"
        description={
          <>
            {summary}. El turno pasa a <strong className="text-fg">no asistió</strong>: la
            sesión se da por consumida y no se devuelve.
          </>
        }
        confirmLabel="Sí, no asistió"
        busyLabel="Guardando…"
        tone="danger"
        onConfirm={() => run("no_show")}
      />

      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => setDialog(o ? "cancel" : null)}
        title="Cancelar el turno"
        description={
          membership ? (
            <>
              {summary}. Se cancela la clase y el horario queda libre. Las clases del abono{" "}
              <strong className="text-fg">no se devuelven</strong> como crédito. Si el
              cliente puede ir otro día, es mejor que la mueva.
            </>
          ) : (
            <>
              {summary}. Se libera el horario y el cliente recibe el aviso. Si ya pagó, la
              sesión le queda <strong className="text-fg">a favor</strong> para otro día.
              Esto no se puede deshacer.
            </>
          )
        }
        confirmLabel="Sí, cancelar turno"
        busyLabel="Cancelando…"
        tone="danger"
        onConfirm={() => run("cancel")}
      />

      <Dialog open={dialog === "reschedule"} onOpenChange={(o) => setDialog(o ? "reschedule" : null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reprogramar</DialogTitle>
            <DialogDescription>{summary}</DialogDescription>
          </DialogHeader>
          <p className="rounded-md border border-amber-400/25 bg-amber-400/5 px-3 py-2.5 text-sm text-amber-300">
            Al elegir un horario el turno se mueve en el acto: el actual se libera y el
            cliente recibe un aviso con el nuevo. Acordalo con él antes.
          </p>
          <ReschedulePanel
            bookingId={bookingId}
            serviceId={serviceId}
            onDone={() => {
              setDialog(null);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
