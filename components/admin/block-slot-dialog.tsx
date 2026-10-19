"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { readError } from "@/lib/read-error";
import { fmtTime, fmtDayLabel, DEFAULT_TZ } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type FreeSlot = {
  starts_at: string;
  ends_at: string;
  free_resources?: { id: string; name: string }[];
};
type Day = { date: string; slots: FreeSlot[] };

// "Bloquear horario": hold a slot under a name — the cash client at the desk,
// a walk-in, a repair. It takes the slot like a turno (same DB guard), shows
// in the agenda and the calendar, and nobody is charged (ADR 0014). Admin
// scope: slots beyond the client booking window are offered too.
export function BlockSlotDialog({
  serviceId,
  sectorName,
  multiBed = false,
}: {
  /** Any plan of the sector: it names the sector; the grid gives the length. */
  serviceId: string;
  sectorName: string;
  /** Offer the bed when a slot has more than one free. */
  multiBed?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<Day[] | null>(null);
  const [tz, setTz] = useState(DEFAULT_TZ);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<FreeSlot | null>(null);
  const [bed, setBed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on open (not in an effect): the dialog is the external event.
  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setDays(null);
    setSlot(null);
    setError(null);
    supabase.functions
      .invoke("availability", { body: { service_id: serviceId, scope: "admin" } })
      .then(({ data, error: err }) => {
        if (err) {
          setError("No se pudieron cargar horarios.");
          setDays([]);
          return;
        }
        const ds: Day[] = data?.days ?? [];
        setDays(ds);
        setTz(data?.timezone ?? DEFAULT_TZ);
        setActiveDay(ds[0]?.date ?? null);
      });
  }

  async function block() {
    const name = label.trim();
    if (!slot || !name) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.functions.invoke("admin-booking", {
      body: {
        action: "block",
        service_id: serviceId,
        starts_at: slot.starts_at,
        label: name,
        resource_id: multiBed ? bed : null,
      },
    });
    setBusy(false);
    if (err) {
      setError(await readError(err, "No se pudo bloquear el horario."));
      return;
    }
    setOpen(false);
    setLabel("");
    router.refresh();
  }

  const day = days?.find((d) => d.date === activeDay);
  const beds = slot?.free_resources ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Lock data-icon="inline-start" aria-hidden />
          Bloquear horario
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bloquear un horario · {sectorName}</DialogTitle>
          <DialogDescription>
            Para quien paga en efectivo o reserva en el mostrador. El horario queda tomado
            con ese nombre; nadie puede reservarlo online y no se cobra nada desde la app.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="block-label">A nombre de</Label>
          <Input
            id="block-label"
            value={label}
            maxLength={60}
            autoFocus
            placeholder="Ej. Juan Pérez · efectivo"
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        {days === null ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : days.length === 0 ? (
          <p className={cn("text-sm", error ? "text-danger" : "text-fg-faint")}>
            {error ?? "No hay horarios libres."}
          </p>
        ) : (
          <>
            <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
              {days.map((d) => (
                <Button
                  key={d.date}
                  type="button"
                  size="sm"
                  variant={d.date === activeDay ? "default" : "outline"}
                  aria-pressed={d.date === activeDay}
                  onClick={() => {
                    setActiveDay(d.date);
                    setSlot(null);
                  }}
                  className="shrink-0 capitalize"
                >
                  {fmtDayLabel(d.date)}
                </Button>
              ))}
            </div>
            {day && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {day.slots.map((s) => {
                  const sel = slot?.starts_at === s.starts_at;
                  return (
                    <Button
                      key={s.starts_at}
                      type="button"
                      variant={sel ? "default" : "outline"}
                      aria-pressed={sel}
                      disabled={busy}
                      onClick={() => {
                        setSlot(s);
                        setBed(s.free_resources?.[0]?.id ?? null);
                      }}
                      className="font-mono font-normal tabular-nums"
                    >
                      {fmtTime(s.starts_at, tz)}
                    </Button>
                  );
                })}
              </div>
            )}
            {multiBed && slot && beds.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-fg-muted">Cama</span>
                {beds.map((r) => (
                  <Button
                    key={r.id}
                    type="button"
                    size="sm"
                    variant={bed === r.id ? "default" : "outline"}
                    aria-pressed={bed === r.id}
                    onClick={() => setBed(r.id)}
                  >
                    {r.name}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {error && days !== null && days.length > 0 && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button disabled={!slot || !label.trim() || busy} onClick={block}>
          {busy
            ? "Bloqueando…"
            : !label.trim()
              ? "Escribí un nombre"
              : slot
                ? `Bloquear ${fmtDayLabel(activeDay!)} ${fmtTime(slot.starts_at, tz)}`
                : "Elegí un horario"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
