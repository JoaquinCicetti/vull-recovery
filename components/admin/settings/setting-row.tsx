"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Ajustes as a settings list: each setting is one row with what it is set to
 * now, and editing happens in a dialog. The page stays one short screen on a phone.
 */
export function SettingsGroup({
  title,
  description,
  action,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right of the title (e.g. "Nuevo plan"). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("max-w-2xl", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">{title}</h2>
        {action}
      </div>
      {description && <p className="mt-1 max-w-prose text-sm text-fg-muted">{description}</p>}
      <ul className="surface-card mt-3 divide-y divide-border">{children}</ul>
    </section>
  );
}

/** A setting: label over its current value; the whole row opens the editor. */
export function SettingRow({
  label,
  value,
  onEdit,
  trailing,
  muted,
}: {
  label: ReactNode;
  value?: ReactNode;
  /** Opens the editor. Omit for a row whose control is `trailing` (a switch). */
  onEdit?: () => void;
  trailing?: ReactNode;
  muted?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm font-medium", muted ? "text-fg-muted" : "text-fg")}>{label}</span>
        {value && <span className="mt-0.5 block truncate text-sm text-fg-faint">{value}</span>}
      </span>
      {trailing}
      {onEdit && <ChevronRight className="size-4 shrink-0 text-fg-faint" aria-hidden />}
    </>
  );
  return (
    <li>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3.5">{body}</div>
      )}
    </li>
  );
}

/** The editor of one setting: a form in a dialog with Cancelar / Guardar. */
export function EditDialog({
  open,
  onOpenChange,
  title,
  description,
  onSave,
  busy,
  dirty = true,
  error,
  saveLabel = "Guardar",
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Omit for a dialog that saves on its own (its rows each save). */
  onSave?: () => void;
  busy?: boolean;
  dirty?: boolean;
  error?: string | null;
  saveLabel?: string;
  children: ReactNode;
  /** Extra footer content on the left (e.g. a destructive action). */
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave?.();
          }}
          className="flex flex-col gap-4"
        >
          {children}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <div>{footer}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                {onSave ? "Cancelar" : "Cerrar"}
              </Button>
              {onSave && (
                <Button type="submit" disabled={busy || !dirty}>
                  {busy ? "Guardando…" : saveLabel}
                </Button>
              )}
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
