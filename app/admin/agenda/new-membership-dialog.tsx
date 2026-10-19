"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Service } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { NewMembershipForm } from "./new-membership-form";

// "Nuevo abono" behind a button: the desk sale form is long (client lookup,
// plan, schedule picker) and belongs on top of the list, not in the middle of
// it. `initialEmail` (from a client's page) opens it straight away.
export function NewMembershipDialog({
  plans,
  today,
  maxStart,
  initialEmail = "",
}: {
  plans: Service[];
  today: string;
  maxStart: string;
  initialEmail?: string;
}) {
  const [open, setOpen] = useState(Boolean(initialEmail));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" aria-hidden />
          Nuevo abono
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo abono</DialogTitle>
          <DialogDescription>
            Venta en el mostrador. Si el cliente no tiene cuenta, se la creamos con su email.
          </DialogDescription>
        </DialogHeader>
        <NewMembershipForm
          plans={plans}
          today={today}
          maxStart={maxStart}
          initialEmail={initialEmail}
        />
      </DialogContent>
    </Dialog>
  );
}
