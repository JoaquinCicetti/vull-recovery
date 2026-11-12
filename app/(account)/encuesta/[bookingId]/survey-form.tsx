"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChoiceGroup, NumberStepper, Question, ScaleInput, StationChips } from "@/components/survey/inputs";
import {
  EMPTY_ANSWERS,
  LEVELS,
  PRE_KEYS,
  SCALES,
  stepValid,
  YES_SOME,
  type SurveyAnswers,
} from "@/lib/survey";
import { cn } from "@/lib/utils";

const STEPS = [
  { title: "Sobre vos", lead: "Para entender tu contexto deportivo." },
  { title: "Antes de la sesión", lead: "¿Cómo llegaste? Del 0 al 10." },
  { title: "Después de la sesión", lead: "¿Cómo te fuiste?" },
  { title: "Tu opinión", lead: "Lo que nos digas nos ayuda a mejorar." },
];

export function SurveyForm({
  bookingId,
  stations,
  prefill,
  preview = false,
  onRestart,
}: {
  bookingId: string;
  /** What the booked plan includes: the options of "lo más beneficioso". */
  stations: string[];
  /** "Sobre vos" from the client's last survey. */
  prefill: Partial<SurveyAnswers>;
  /** Admin preview: same form, nothing stored (no draft, no submit). */
  preview?: boolean;
  /** Preview only: "Probar de nuevo" on the thank-you screen. */
  onRestart?: () => void;
}) {
  const draftKey = `vull:survey:${bookingId}`;
  const [answers, setAnswers] = useState<SurveyAnswers>({ ...EMPTY_ANSWERS, ...prefill });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const reduce = useReducedMotion();
  const top = useRef<HTMLDivElement>(null);

  // Restore an unsent draft (a reload, an accidental back) once, on mount.
  useEffect(() => {
    if (preview) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { answers: SurveyAnswers; step: number };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
      setAnswers((a) => ({ ...a, ...d.answers }));
      setStep(Math.min(3, Math.max(0, d.step | 0)));
      setOtherOpen(Boolean(d.answers.best_station_other));
    } catch {
      /* storage unavailable: start fresh */
    }
  }, [draftKey, preview]);

  useEffect(() => {
    if (done || preview) return;
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ answers, step }));
    } catch {
      /* ignore */
    }
  }, [answers, step, done, draftKey, preview]);

  const set = <K extends keyof SurveyAnswers>(k: K, v: SurveyAnswers[K]) =>
    setAnswers((a) => ({ ...a, [k]: v }));

  function go(to: number) {
    setDir(to > step ? 1 : -1);
    setStep(to);
    setError(null);
    top.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  async function submit() {
    if (preview) {
      setDone(true);
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_session_survey", {
      p_booking: bookingId,
      p_answers: answers,
    });
    setSaving(false);
    if (error) {
      setError(error.message || "No pudimos guardar tus respuestas. Probá de nuevo.");
      return;
    }
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    setDone(true);
  }

  if (done) return <ThankYou preview={preview} onRestart={onRestart} />;

  const valid = stepValid(step, answers);
  const last = step === STEPS.length - 1;
  const offset = reduce ? 0 : 24;

  return (
    <div ref={top} className="scroll-mt-24">
      {/* progress */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">
            Paso {step + 1} de {STEPS.length}
          </p>
          <p className="font-mono text-xs tabular-nums text-fg-faint">
            {Math.round((step / STEPS.length) * 100)}%
          </p>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <div key={i} className="h-1 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn(
                  "h-full origin-left bg-accent transition-transform duration-300 ease-out",
                  i < step ? "scale-x-100" : i === step ? "scale-x-50" : "scale-x-0",
                )}
              />
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" custom={dir} initial={false}>
        <motion.section
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: dir * offset }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -dir * offset }}
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          className="surface-card surface-lift p-5 sm:p-7"
          aria-labelledby="survey-step-title"
        >
          <header className="mb-6">
            <h2 id="survey-step-title" className="text-xl font-bold tracking-[-0.02em] text-fg">
              {STEPS[step].title}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{STEPS[step].lead}</p>
          </header>

          <div className="space-y-7">
            {step === 0 && (
              <>
                <div className="grid gap-7 sm:grid-cols-2">
                  <NumberStepper label="Edad" value={answers.age} onChange={(v) => set("age", v)} min={5} max={120} unit="años" />
                  <NumberStepper
                    label="¿Cuántos días por semana entrenás?"
                    value={answers.training_days}
                    onChange={(v) => set("training_days", v)}
                    min={0}
                    max={7}
                    unit="días"
                  />
                </div>
                <Question label="Deporte que practicás">
                  <Input
                    value={answers.sport}
                    onChange={(e) => set("sport", e.target.value.slice(0, 80))}
                    placeholder="Fútbol, running, crossfit…"
                    autoComplete="off"
                    className="h-11"
                  />
                </Question>
                <ChoiceGroup label="Nivel" options={LEVELS} value={answers.level} onChange={(v) => set("level", v)} />
              </>
            )}

            {step === 1 &&
              PRE_KEYS.map((k) => (
                <ScaleInput key={k} {...SCALES[k]} value={answers[k]} onChange={(v) => set(k, v)} />
              ))}

            {step === 2 && (
              <>
                <ScaleInput {...SCALES.post_overall} value={answers.post_overall} onChange={(v) => set("post_overall", v)} />
                <ChoiceGroup
                  label="¿Sentís una disminución de la tensión muscular?"
                  options={YES_SOME}
                  value={answers.tension_relief}
                  onChange={(v) => set("tension_relief", v)}
                />
                <ChoiceGroup
                  label="¿Percibís mayor movilidad?"
                  options={YES_SOME}
                  value={answers.mobility_gain}
                  onChange={(v) => set("mobility_gain", v)}
                />
                {stations.length > 0 ? (
                  <div className="space-y-2">
                    <StationChips
                      label="¿Qué parte del circuito te resultó más beneficiosa?"
                      hint="Podés elegir más de una."
                      options={stations}
                      value={answers.best_stations}
                      onChange={(v) => set("best_stations", v)}
                    />
                    {otherOpen ? (
                      <Input
                        autoFocus
                        value={answers.best_station_other}
                        onChange={(e) => set("best_station_other", e.target.value.slice(0, 200))}
                        placeholder="Contanos cuál"
                        className="h-11"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOtherOpen(true)}
                        className="text-sm font-medium text-fg-faint underline-offset-4 hover:text-fg hover:underline"
                      >
                        + Otra
                      </button>
                    )}
                  </div>
                ) : (
                  <Question label="¿Qué parte del circuito te resultó más beneficiosa?">
                    <Input
                      value={answers.best_station_other}
                      onChange={(e) => set("best_station_other", e.target.value.slice(0, 200))}
                      placeholder="Ej.: la inmersión en frío"
                      className="h-11"
                    />
                  </Question>
                )}
                <ScaleInput {...SCALES.experience} value={answers.experience} onChange={(v) => set("experience", v)} />
              </>
            )}

            {step === 3 && (
              <>
                <Question label="¿Qué fue lo que más valoraste de la sesión?" hint="Opcional">
                  <Textarea
                    rows={3}
                    value={answers.valued}
                    onChange={(e) => set("valued", e.target.value.slice(0, 2000))}
                    placeholder="La atención, el frío, el ambiente…"
                  />
                </Question>
                <Question label="¿Hay algo que mejorarías?" hint="Opcional">
                  <Textarea
                    rows={3}
                    value={answers.improve}
                    onChange={(e) => set("improve", e.target.value.slice(0, 2000))}
                    placeholder="Todo suma."
                  />
                </Question>
                <ScaleInput {...SCALES.nps} value={answers.nps} onChange={(v) => set("nps", v)} />
              </>
            )}
          </div>
        </motion.section>
      </AnimatePresence>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Sticky on a phone so "Siguiente" is always under the thumb. */}
      <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex gap-2 border-t border-border bg-bg/85 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        {step > 0 && (
          <Button type="button" variant="outline" size="lg" onClick={() => go(step - 1)} aria-label="Anterior">
            <ArrowLeft />
          </Button>
        )}
        {last ? (
          <Button type="button" size="lg" className="flex-1" disabled={!valid || saving} onClick={submit}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Enviar respuestas
          </Button>
        ) : (
          <Button type="button" size="lg" className="flex-1" disabled={!valid} onClick={() => go(step + 1)}>
            Siguiente
            <ArrowRight />
          </Button>
        )}
      </div>
      {!valid && (
        <p className="mt-2 text-center text-xs text-fg-faint">Respondé las preguntas de este paso para seguir.</p>
      )}
    </div>
  );
}

export function ThankYou({
  again = false,
  preview = false,
  onRestart,
}: {
  again?: boolean;
  preview?: boolean;
  onRestart?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
      className="surface-card surface-lift px-6 py-10 text-center"
    >
      <div className="mx-auto flex size-12 items-center justify-center rounded-md border border-accent/40 bg-accent/15">
        <Check className="size-6 text-accent" />
      </div>
      <h2 className="mt-5 text-2xl font-bold tracking-[-0.02em] text-fg">¡Muchas gracias!</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">
        {again
          ? "Ya respondiste la encuesta de esta sesión."
          : "Tus respuestas nos ayudan a seguir mejorando nuestros protocolos de recuperación."}
      </p>
      <p className="mt-8 text-xs font-bold uppercase tracking-[0.22em] text-fg">VULL Recovery</p>
      <p className="mt-1 text-xs text-fg-faint">Recuperación deportiva.</p>
      {preview ? (
        <Button variant="outline" className="mt-8" onClick={onRestart}>
          Probar de nuevo
        </Button>
      ) : (
        <Button asChild variant="outline" className="mt-8">
          <Link href="/mis-turnos">Ir a mis turnos</Link>
        </Button>
      )}
    </motion.div>
  );
}
