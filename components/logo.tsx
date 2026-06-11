import { cn } from "@/lib/utils";
import { SITE_NAME } from "@/lib/site";

// Brand logo. Drop your logo file at `public/logo.svg` (a square mark works best).
// If that file already includes the "VULL" wordmark, use <Logo withWordmark={false} />.
export function Logo({
  withWordmark = true,
  className = "",
  imgClassName = "h-7",
}: {
  withWordmark?: boolean;
  className?: string;
  /** Tailwind height for the mark (e.g. "h-10"). */
  imgClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.jpg"
        alt={SITE_NAME}
        className={cn("w-auto shrink-0 rounded-md", imgClassName)}
      />
      {withWordmark && (
        <span className="hidden text-sm font-semibold uppercase tracking-[0.18em] text-fg sm:inline">
          {SITE_NAME}
        </span>
      )}
    </span>
  );
}
