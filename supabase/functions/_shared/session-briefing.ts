// Pre-session recommendations shown after a recovery turno is confirmed: in the
// confirmation dialog on /turno/[id] and in the confirmation email. Plain data so
// both server and client components can import it.
//
// Deno mirror of lib/session-briefing.ts, used by the confirmation email
// (_shared/email.ts). Next.js and Deno cannot share a module, so this is a
// deliberate duplicate. Change one, change both.
export const SESSION_BRIEFING = {
  /** Only this sector's turnos get the briefing (it describes the circuit). */
  sectorSlug: "recovery" as const,
  title: "Antes de tu sesión",
  intro: "Te dejamos algunas recomendaciones importantes para tu sesión en VULL Lab:",
  bring: [
    "Te pedimos que vengas con ropa deportiva, malla o indumentaria apta para espacios húmedos.",
    "Es importante traer toalla personal, ojotas y una muda de ropa extra para después de la sesión.",
    "Traé también tu botellita de agua, ya que la hidratación es fundamental antes y después del circuito. En el espacio contamos con dispenser de agua para recargar.",
  ],
  facilities:
    "En VULL disponemos de vestuarios y duchas, para que puedas realizar la sesión con comodidad.",
  healthIntro:
    "Antes de la sesión, es importante que tengas en cuenta las siguientes condiciones de salud.",
  healthLead: "No se recomienda realizar el circuito si presentás:",
  contraindications: [
    "Heridas abiertas",
    "Infecciones activas",
    "Déficit sensitivo",
    "Hipertensión arterial no controlada (especialmente para sauna)",
    "Intolerancia al frío",
    "Lesiones en la piel",
  ],
  healthNote:
    "Si tenés alguna condición de salud o duda, avisanos antes de la sesión para evaluar el protocolo adecuado o reprogramar si es necesario.",
};
