"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Qué incluye" a plan: a short list of stations (Inmersión en frío, Sauna…).
 * Add with Enter, remove with ×, move with the arrows. Duplicates are ignored.
 */
export function StationsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function add() {
    const s = draft.trim().slice(0, 60);
    if (!s) return;
    if (!value.some((v) => v.toLowerCase() === s.toLowerCase())) onChange([...value, s]);
    setDraft("");
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div>
      <Label className="text-xs text-fg-muted">Qué incluye</Label>
      {value.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {value.map((s, i) => (
            <li
              key={s}
              className="inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-surface-2 pl-1 pr-1 text-sm text-fg"
            >
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Mover ${s} antes`}
                className="rounded p-0.5 text-fg-faint hover:text-fg disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="px-1">{s}</span>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                aria-label={`Mover ${s} después`}
                className="rounded p-0.5 text-fg-faint hover:text-fg disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== s))}
                aria-label={`Quitar ${s}`}
                className="ml-0.5 rounded p-0.5 text-fg-faint hover:text-danger"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-1.5 flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Ej.: Inmersión en frío"
          aria-label="Agregar lo que incluye"
        />
        <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()} aria-label="Agregar">
          <Plus />
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-fg-faint">
        Se muestran como etiquetas en el plan y son las opciones de «lo más beneficioso» en la encuesta.
      </p>
    </div>
  );
}
