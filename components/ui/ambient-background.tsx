import { HeroParticles } from "@/components/landing/hero-particles";

/**
 * App-wide atmospheric backdrop: the green laser-dot field from the landing hero,
 * rendered once behind every page so no route reads as flat solid black. Sits
 * under the body's top radial glow; pointer-transparent and decorative only.
 *
 * Strength is deliberately low here (the hero keeps its own brighter instance
 * over the facility photo). Under `prefers-reduced-motion`, HeroParticles renders
 * nothing and only the static body glow remains.
 */
export function AmbientBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Deep floor glow so long pages don't fade into a void at the bottom. */}
      <div className="absolute inset-x-0 bottom-0 h-[45vh] bg-[radial-gradient(60%_100%_at_50%_120%,oklch(0.7_0.16_140/0.12),transparent_70%)]" />
      <HeroParticles className="opacity-80" />
    </div>
  );
}
