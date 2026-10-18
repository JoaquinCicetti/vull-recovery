"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SessionBriefing } from "@/components/session-briefing";
import { SESSION_BRIEFING } from "@/lib/session-briefing";

const storageKey = (bookingId: string) => `vull:briefing-shown:${bookingId}`;

function BriefingContent() {
  return (
    <DialogContent className="max-h-[80svh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Check className="size-5 shrink-0 text-accent" aria-hidden="true" />
          Tu turno está confirmado
        </DialogTitle>
        <DialogDescription>{SESSION_BRIEFING.title}</DialogDescription>
      </DialogHeader>
      <SessionBriefing />
      <DialogFooter>
        <DialogClose asChild>
          <Button size="lg" className="w-full sm:w-auto">
            Entendido
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

// Opens the briefing once per booking, the first time /turno/[id] renders it
// confirmed. Every confirm path (credit, Talo settle, admin approval) lands the
// client there, so this is the single trigger; the localStorage key makes it
// one-shot per browser. Without storage (private mode) it just opens each visit.
export function SessionBriefingDialog({ bookingId }: { bookingId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(storageKey(bookingId)) !== null;
      if (!seen) window.localStorage.setItem(storageKey(bookingId), "1");
    } catch {
      /* storage unavailable: show it */
    }
    // Opening after mount (not as initial state) keeps SSR markup closed and
    // the read of localStorage client-only.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!seen) setOpen(true);
  }, [bookingId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <BriefingContent />
    </Dialog>
  );
}

// "Ver recomendaciones": reopens the same briefing on demand; never touches the
// one-shot key.
export function SessionBriefingTrigger() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="lg" className="w-full">
          Ver recomendaciones
        </Button>
      </DialogTrigger>
      <BriefingContent />
    </Dialog>
  );
}
