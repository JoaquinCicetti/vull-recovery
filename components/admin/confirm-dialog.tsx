"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// One question before an action with consequences. `tone="danger"` is for the
// irreversible ones (cancel, release, delete): the confirm button is red and
// the copy says what is lost. The action runs on confirm; a thrown/returned
// error stays in the dialog next to the buttons.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  busyLabel = "Un momento…",
  tone = "default",
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  tone?: "default" | "danger";
  /** Resolves to an error message to show, or null when done. */
  onConfirm: () => Promise<string | null>;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const err = await onConfirm();
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" className="text-fg-muted" disabled={busy} onClick={() => onOpenChange(false)}>
            Volver
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "default"}
            disabled={busy}
            onClick={run}
          >
            {busy ? busyLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
