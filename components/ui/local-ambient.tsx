import { HeroParticles } from "@/components/landing/hero-particles";
import { cn } from "@/lib/utils";

/**
 * A localized, *stronger* version of the global ambient: the green laser-dot
 * field plus a breathing radial glow, for a hero-like band behind a section
 * (plans grid, checkout header) so it reads as alive rather than flat black.
 *
 * Drop inside a `relative` container; keep the section's real content above it
 * (e.g. wrap content in `relative z-10`). Decorative + pointer-transparent;
 * HeroParticles self-silences under `prefers-reduced-motion`.
 */
export function LocalAmbient({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
    >
      <div
        className="absolute inset-0 animate-glow-pulse"
        style={{
          background:
            "radial-gradient(60% 70% at 50% 0%, rgba(97,179,59,0.18), transparent 65%)",
        }}
      />
      <HeroParticles className="opacity-70" />
    </div>
  );
}
