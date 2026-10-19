import Link from "next/link";
import { cn } from "@/lib/utils";

export type Segment = { href: string; label: string; active: boolean; count?: number };

// A row of mutually exclusive views as links (server-rendered, query-string
// driven). `prominent` is the sector switch: the one control that must read
// first on every agenda screen, so it is larger and fills the row on a phone.
export function Segmented({
  items,
  label,
  prominent = false,
  className,
}: {
  items: Segment[];
  label: string;
  prominent?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label={label}
      className={cn(
        "inline-flex rounded-md border border-border bg-surface-2 p-0.5",
        prominent && "flex w-full sm:inline-flex sm:w-auto",
        className,
      )}
    >
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          aria-current={it.active ? "page" : undefined}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-[5px] text-center transition-colors duration-150",
            prominent ? "flex-1 px-4 py-2 text-sm font-semibold sm:flex-none sm:px-5" : "px-3 py-1.5 text-sm",
            it.active ? "bg-surface text-fg ring-1 ring-border-strong" : "text-fg-muted hover:text-fg",
          )}
        >
          {it.label}
          {it.count != null && (
            <span
              className={cn(
                "font-mono text-[11px] tabular-nums",
                it.active ? "text-accent" : "text-fg-faint",
              )}
            >
              {it.count}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
