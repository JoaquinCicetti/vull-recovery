"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtDateTime } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LEVEL_LABEL, PRE_KEYS, SCALES, SURVEY_COLUMNS, YES_LABEL, type SurveyRow } from "@/lib/survey";
import { cn } from "@/lib/utils";

type Full = SurveyRow & {
  services: { name: string } | null;
  bookings: { starts_at: string } | null;
  profiles: { full_name: string | null } | null;
};

/** Every answer of one survey (ADR 0017), loaded when it opens. */
export function SurveyResponseDialog({
  surveyId,
  open,
  onOpenChange,
}: {
  surveyId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [row, setRow] = useState<Full | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !surveyId) return;
    let live = true;
    createClient()
      .from("session_surveys")
      .select(`${SURVEY_COLUMNS}, services(name), bookings(starts_at), profiles(full_name)`)
      .eq("id", surveyId)
      .maybeSingle<Full>()
      .then(({ data, error }) => {
        if (!live) return;
        setRow(data);
        setError(error ? error.message : data ? null : "No encontramos la encuesta.");
      });
    return () => {
      live = false;
    };
  }, [open, surveyId]);

  const loaded = row && row.id === surveyId ? row : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{loaded?.profiles?.full_name ?? "Encuesta"}</DialogTitle>
          <DialogDescription>
            {loaded
              ? [loaded.services?.name, loaded.bookings && fmtDateTime(loaded.bookings.starts_at)]
                  .filter(Boolean)
                  .join(" · ")
              : "Respuestas de la sesión"}
          </DialogDescription>
        </DialogHeader>

        {!loaded ? (
          error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-fg-faint" />
            </div>
          )
        ) : (
          <SurveyAnswersView s={loaded} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Score({ n }: { n: number | null }) {
  if (n === null) return <span className="text-fg-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-3 sm:block" aria-hidden>
        <span className="block h-full bg-accent" style={{ width: `${n * 10}%` }} />
      </span>
      <span className="w-9 text-right font-mono font-semibold tabular-nums text-fg">{n}/10</span>
    </span>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="shrink-0 text-right">{children}</span>
    </div>
  );
}

function Block({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-1", className)}>
      <h3 className="eyebrow">{title}</h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

export function SurveyAnswersView({ s }: { s: SurveyRow }) {
  return (
    <div className="space-y-6">
      <Block title="Sobre vos">
        <Line label="Edad">{s.age ?? "—"}</Line>
        <Line label="Deporte">{s.sport || "—"}</Line>
        <Line label="Nivel">{s.level ? LEVEL_LABEL[s.level] : "—"}</Line>
        <Line label="Entrena">{s.training_days != null ? `${s.training_days} días/sem` : "—"}</Line>
      </Block>
      <Block title="Antes">
        {PRE_KEYS.map((k) => (
          <Line key={k} label={SCALES[k].label}>
            <Score n={s[k]} />
          </Line>
        ))}
      </Block>
      <Block title="Después">
        <Line label="Estado físico general">
          <Score n={s.post_overall} />
        </Line>
        <Line label="Menos tensión muscular">{s.tension_relief ? YES_LABEL[s.tension_relief] : "—"}</Line>
        <Line label="Más movilidad">{s.mobility_gain ? YES_LABEL[s.mobility_gain] : "—"}</Line>
        <Line label="Lo más beneficioso">
          <span className="text-fg">
            {[...(s.best_stations ?? []), s.best_station_other].filter(Boolean).join(", ") || "—"}
          </span>
        </Line>
        <Line label="Experiencia general">
          <Score n={s.experience} />
        </Line>
      </Block>
      <Block title="Opinión">
        <Line label="Recomendaría VULL">
          <Score n={s.nps} />
        </Line>
        {s.valued && (
          <div className="py-2 text-sm">
            <p className="text-fg-muted">Lo que más valoró</p>
            <p className="mt-1 whitespace-pre-wrap text-fg">{s.valued}</p>
          </div>
        )}
        {s.improve && (
          <div className="py-2 text-sm">
            <p className="text-fg-muted">Qué mejoraría</p>
            <p className="mt-1 whitespace-pre-wrap text-fg">{s.improve}</p>
          </div>
        )}
      </Block>
    </div>
  );
}
