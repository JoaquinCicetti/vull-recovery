"use client";

import { useId, useRef, type KeyboardEvent } from "react";
import { Check, Minus, Plus, Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Arrow keys move the selection inside a radiogroup (roving tabindex). */
function onArrows<T>(e: KeyboardEvent, options: T[], value: T | null, set: (v: T) => void, root: HTMLElement | null) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const i = value === null ? -1 : options.indexOf(value);
  let next = i;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(options.length - 1, i + 1);
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, i - 1);
  if (e.key === "Home") next = 0;
  if (e.key === "End") next = options.length - 1;
  set(options[next]);
  root?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
}

/** One question: label above, control below. */
export function Question({
  label,
  hint,
  children,
  id,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p id={id} className="text-[15px] font-semibold leading-snug text-fg">
          {label}
        </p>
        {hint && <p className="mt-0.5 text-xs text-fg-faint">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const SCALE = Array.from({ length: 11 }, (_, i) => i);

/**
 * 0–10 as an instrument meter: eleven cells; the picked one is lit green and the
 * cells up to it fill in, so the value reads at a glance. Tap, or arrow keys.
 */
export function ScaleInput({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Question label={label} id={id}>
      <div
        ref={ref}
        role="radiogroup"
        aria-labelledby={id}
        className="grid grid-cols-11 gap-1"
        onKeyDown={(e) => onArrows(e, SCALE, value, onChange, ref.current)}
      >
        {SCALE.map((n) => {
          const selected = value === n;
          const filled = value !== null && n < value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${n}`}
              tabIndex={selected || (value === null && n === 0) ? 0 : -1}
              onClick={() => onChange(n)}
              className={cn(
                "relative flex h-11 items-center justify-center rounded-[5px] border font-mono text-sm tabular-nums",
                "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                selected
                  ? "border-accent bg-accent font-bold text-on-accent"
                  : filled
                    ? "border-accent/30 bg-accent/15 text-fg"
                    : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
        <span>0 · {low}</span>
        <span>{high} · 10</span>
      </div>
    </Question>
  );
}

/** A single choice among a few labelled options (Nivel, Sí / Un poco / No). */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const values = options.map((o) => o.value);
  return (
    <Question label={label} id={id}>
      <div
        ref={ref}
        role="radiogroup"
        aria-labelledby={id}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        onKeyDown={(e) => onArrows(e, values, value, onChange, ref.current)}
      >
        {options.map((o, i) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (value === null && i === 0) ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn(
                "h-11 rounded-md border px-2 text-sm font-semibold",
                "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                selected
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </Question>
  );
}

/** A small integer with − / + (age, training days). Typing works too. */
export function NumberStepper({
  label,
  value,
  onChange,
  min,
  max,
  unit,
  placeholder = "—",
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  unit?: string;
  placeholder?: string;
}) {
  const id = useId();
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const step = (d: number) => onChange(clamp((value ?? (d > 0 ? min - 1 : min + 1)) + d));
  const btn =
    "flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-muted transition-[border-color,color,transform] duration-150 hover:border-border-strong hover:text-fg active:scale-95 disabled:opacity-40";
  return (
    <Question label={label}>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={value !== null && value <= min} aria-label="Menos">
          <Minus className="size-4" />
        </button>
        <label htmlFor={id} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2 focus-within:border-accent/60">
          <input
            id={id}
            inputMode="numeric"
            aria-label={label}
            value={value ?? ""}
            placeholder={placeholder}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 3);
              onChange(digits === "" ? null : Math.min(max, Number(digits)));
            }}
            className="w-12 bg-transparent text-center font-mono text-lg font-bold tabular-nums text-fg outline-none placeholder:text-fg-faint"
          />
          {unit && <span className="text-xs text-fg-faint">{unit}</span>}
        </label>
        <button type="button" className={btn} onClick={() => step(1)} disabled={value !== null && value >= max} aria-label="Más">
          <Plus className="size-4" />
        </button>
      </div>
    </Question>
  );
}

/** Pick any of the plan's stations (what it includes). */
export function StationChips({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (s: string) => onChange(value.includes(s) ? value.filter((x) => x !== s) : [...value, s]);
  return (
    <Question label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5">
        {options.map((s) => {
          const on = value.includes(s);
          return (
            <button
              key={s}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(s)}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium",
                "transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                on
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-border bg-surface-2 text-fg-muted hover:border-border-strong hover:text-fg",
              )}
            >
              <Check
                className={cn("size-3.5 text-accent transition-[opacity,width] duration-150", on ? "opacity-100" : "w-0 opacity-0")}
                aria-hidden
              />
              {s}
            </button>
          );
        })}
      </div>
    </Question>
  );
}

const STARS = [1, 2, 3, 4, 5];

/** 1–5 stars. Optional: picking the current value again clears it. */
export function StarInput({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  return (
    <Question label={label} hint={hint} id={id}>
      <div
        ref={ref}
        role="radiogroup"
        aria-labelledby={id}
        className="flex gap-1"
        onKeyDown={(e) => onArrows(e, STARS, value, onChange, ref.current)}
      >
        {STARS.map((n) => {
          const selected = value === n;
          const lit = value !== null && n <= value;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={n === 1 ? "1 estrella" : `${n} estrellas`}
              tabIndex={selected || (value === null && n === 1) ? 0 : -1}
              onClick={() => onChange(selected ? null : n)}
              className={cn(
                "flex size-11 items-center justify-center rounded-md",
                "transition-[color,transform] duration-150 ease-out active:scale-90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                lit ? "text-accent" : "text-fg-faint hover:text-fg-muted",
              )}
            >
              <Star className={cn("size-7", lit && "fill-current")} aria-hidden />
            </button>
          );
        })}
      </div>
    </Question>
  );
}

/** A rating as read-only stars (public reviews, admin list). */
export function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span role="img" aria-label={`${value} de 5 estrellas`} className={cn("inline-flex gap-0.5", className)}>
      {STARS.map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn("size-3.5", n <= value ? "fill-current text-accent" : "text-fg-faint/50")}
        />
      ))}
    </span>
  );
}
