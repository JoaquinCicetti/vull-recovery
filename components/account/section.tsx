import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A titled block in the account area: mono eyebrow, optional one-line help and
// a right-aligned action. Sections are separated by space, not by nested cards.
export function Section({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-12 first:mt-0", className)}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-fg-faint">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 max-w-prose text-sm text-fg-muted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// One settings line: label + help on the left, a control on the right. Stacks
// inside a `divide-y` card.
export function SettingRow({
  label,
  help,
  control,
  htmlFor,
}: {
  label: ReactNode;
  help?: ReactNode;
  control: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
          {label}
        </label>
        {help && <p className="mt-0.5 text-xs text-fg-faint">{help}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
