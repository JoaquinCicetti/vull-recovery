import { Check, TriangleAlert } from "lucide-react";
import { SESSION_BRIEFING } from "@/lib/session-briefing";
import { cn } from "@/lib/utils";

// The pre-session recommendations (what to bring, health caveats). Purely
// presentational and server-safe; the confirmation dialog wraps it, and the
// confirmation email renders the same data (supabase/functions/_shared).
export function SessionBriefing({ className }: { className?: string }) {
  const b = SESSION_BRIEFING;
  return (
    <div className={cn("space-y-6 text-sm leading-relaxed text-fg-muted", className)}>
      <section>
        <p className="eyebrow">Qué traer</p>
        <p className="mt-2">{b.intro}</p>
        <ul className="mt-3 space-y-2.5">
          {b.bring.map((item) => (
            <li key={item} className="flex gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-fg-faint">{b.facilities}</p>
      </section>

      <section className="border-t border-border pt-5">
        <p className="eyebrow text-amber-300">Condiciones de salud</p>
        <p className="mt-2">
          {b.healthIntro} {b.healthLead}
        </p>
        <ul className="mt-3 space-y-2">
          {b.contraindications.map((item) => (
            <li key={item} className="flex gap-2.5">
              <TriangleAlert
                className="mt-0.5 size-4 shrink-0 text-amber-300"
                aria-hidden="true"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-fg-faint">{b.healthNote}</p>
      </section>
    </div>
  );
}
