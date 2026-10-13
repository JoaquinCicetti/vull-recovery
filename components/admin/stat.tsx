import type { ReactNode } from "react";

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="surface-card p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-fg-faint">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
      {children}
    </h2>
  );
}

// Shared look for the native controls in the GET filter forms (they must stay
// plain form controls so filtering works as a normal navigation).
export const FIELD =
  "glass h-10 rounded-md px-3 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring/25";
