// Post-session survey (ADR 0017): the questions, their order and the labels the
// form, the admin dialog and the stats share. Column names match
// public.session_surveys; submit_session_survey validates the same ranges.

export type Level = "amateur" | "competitivo" | "profesional";
export type YesSome = "si" | "un_poco" | "no";

export type SurveyAnswers = {
  age: number | null;
  sport: string;
  level: Level | null;
  training_days: number | null;
  pre_fatigue: number | null;
  pre_soreness: number | null;
  pre_tiredness: number | null;
  pre_recovery: number | null;
  pre_sleep: number | null;
  post_overall: number | null;
  tension_relief: YesSome | null;
  mobility_gain: YesSome | null;
  best_stations: string[];
  best_station_other: string;
  experience: number | null;
  valued: string;
  improve: string;
  nps: number | null;
};

/** A stored row (admin dialog, client summary). */
export type SurveyRow = Omit<SurveyAnswers, "sport" | "best_station_other" | "valued" | "improve"> & {
  id: string;
  booking_id: string;
  submitted_at: string | null;
  sport: string | null;
  best_station_other: string | null;
  valued: string | null;
  improve: string | null;
};

export const SURVEY_COLUMNS =
  "id, booking_id, submitted_at, age, sport, level, training_days, pre_fatigue, pre_soreness, pre_tiredness, pre_recovery, pre_sleep, post_overall, tension_relief, mobility_gain, best_stations, best_station_other, experience, valued, improve, nps";

export const EMPTY_ANSWERS: SurveyAnswers = {
  age: null,
  sport: "",
  level: null,
  training_days: null,
  pre_fatigue: null,
  pre_soreness: null,
  pre_tiredness: null,
  pre_recovery: null,
  pre_sleep: null,
  post_overall: null,
  tension_relief: null,
  mobility_gain: null,
  best_stations: [],
  best_station_other: "",
  experience: null,
  valued: "",
  improve: "",
  nps: null,
};

export const LEVELS: { value: Level; label: string }[] = [
  { value: "amateur", label: "Amateur" },
  { value: "competitivo", label: "Competitivo" },
  { value: "profesional", label: "Profesional" },
];

export const YES_SOME: { value: YesSome; label: string }[] = [
  { value: "si", label: "Sí" },
  { value: "un_poco", label: "Un poco" },
  { value: "no", label: "No" },
];

export const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.value, l.label])) as Record<Level, string>;
export const YES_LABEL = Object.fromEntries(YES_SOME.map((l) => [l.value, l.label])) as Record<YesSome, string>;

type ScaleKey =
  | "pre_fatigue"
  | "pre_soreness"
  | "pre_tiredness"
  | "pre_recovery"
  | "pre_sleep"
  | "post_overall"
  | "experience"
  | "nps";

/** The 0–10 questions, with what 0 and 10 mean. */
export const SCALES: Record<ScaleKey, { label: string; low: string; high: string }> = {
  pre_fatigue: { label: "Fatiga muscular", low: "Nada", high: "Muchísima" },
  pre_soreness: { label: "Dolor muscular", low: "Nada", high: "Muchísimo" },
  pre_tiredness: { label: "Cansancio general", low: "Nada", high: "Muchísimo" },
  pre_recovery: { label: "Sensación de recuperación", low: "Nada", high: "Totalmente" },
  pre_sleep: { label: "Calidad del sueño de anoche", low: "Pésima", high: "Excelente" },
  post_overall: { label: "¿Cómo calificarías tu estado físico general?", low: "Muy mal", high: "Excelente" },
  experience: { label: "¿Cómo calificarías tu experiencia general?", low: "Muy mala", high: "Excelente" },
  nps: { label: "¿Qué tan probable es que recomiendes VULL?", low: "Nada probable", high: "Muy probable" },
};

export const PRE_KEYS = ["pre_fatigue", "pre_soreness", "pre_tiredness", "pre_recovery", "pre_sleep"] as const;

/** Which steps are complete (the free-text questions are optional). */
export function stepValid(step: number, a: SurveyAnswers): boolean {
  switch (step) {
    case 0:
      return a.age !== null && a.age >= 5 && a.age <= 120 && a.level !== null && a.training_days !== null;
    case 1:
      return PRE_KEYS.every((k) => a[k] !== null);
    case 2:
      return a.post_overall !== null && a.tension_relief !== null && a.mobility_gain !== null && a.experience !== null;
    case 3:
      return a.nps !== null;
    default:
      return false;
  }
}

/** The survey link an admin sends by WhatsApp. */
export function surveyMessage(firstName: string, url: string) {
  const hi = firstName ? `¡Hola ${firstName}!` : "¡Hola!";
  return `${hi} Gracias por venir a VULL Recovery 💚\n\nNos interesa conocer tu experiencia para seguir mejorando nuestros protocolos. ¿Nos regalás 2 minutos?\n\n${url}`;
}
