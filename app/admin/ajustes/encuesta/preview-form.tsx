"use client";

import { useState } from "react";
import { SurveyForm } from "@/app/(account)/encuesta/[bookingId]/survey-form";

/** The client's survey form in preview mode; "Probar de nuevo" starts it over. */
export function PreviewForm({ planId, stations }: { planId: string; stations: string[] }) {
  const [run, setRun] = useState(0);
  return (
    <SurveyForm
      key={`${planId}-${run}`}
      bookingId={`preview-${planId}`}
      stations={stations}
      prefill={{}}
      preview
      onRestart={() => setRun((n) => n + 1)}
    />
  );
}
