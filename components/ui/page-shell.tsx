import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const WIDTHS = {
  narrow: "max-w-md", // auth, single-column forms
  default: "max-w-2xl", // booking, detail, account
  wide: "max-w-4xl", // admin lists / dashboards
} as const;

type PageShellProps = {
  eyebrow?: string;
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered above the header (e.g. a back link). */
  nav?: ReactNode;
  /** Right-aligned header content (links, secondary actions). */
  actions?: ReactNode;
  size?: keyof typeof WIDTHS;
  /** Center the column contents (used by auth). */
  center?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * One container for every inner page: shared gutter, vertical rhythm, content
 * width and header treatment, so routes stop jumping between max-w-md/xl/2xl/3xl.
 * The header animates in; pass `size="wide"` for admin, `size="narrow"` for auth.
 */
export function PageShell({
  eyebrow,
  title,
  description,
  nav,
  actions,
  size = "default",
  center = false,
  className,
  children,
}: PageShellProps) {
  const hasHeader = eyebrow || title || description || actions;
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 py-14 sm:py-16",
        WIDTHS[size],
        center && "flex flex-col items-center text-center",
        className,
      )}
    >
      {nav && <div className="mb-6 animate-fade-up">{nav}</div>}
      {hasHeader && (
        <header
          className={cn(
            "animate-fade-up",
            center && "flex flex-col items-center",
            actions &&
              !center &&
              "flex flex-wrap items-end justify-between gap-4",
          )}
        >
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && (
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                {title}
              </h1>
            )}
            {description && (
              <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-muted">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(hasHeader && "mt-8", "w-full")}>{children}</div>
    </div>
  );
}
