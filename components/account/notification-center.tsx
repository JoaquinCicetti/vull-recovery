"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Laptop, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { currentEndpoint, PUSH_PROBLEM, pushProblem, subscribeThisDevice } from "@/lib/push";
import { Section, SettingRow } from "@/components/account/section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export type PushDevice = {
  id: string;
  endpoint: string;
  userAgent: string | null;
  lastSeenAt: string;
};

// What this browser can do right now.
//   unsupported   → no Web Push here (or VAPID not configured)
//   needs_install → iPhone/iPad outside the installed app
//   denied        → the user blocked the site's notifications in the browser
//   off / on      → can subscribe / is subscribed (see `endpoint`)
type Support = "loading" | "unsupported" | "needs_install" | "denied" | "off" | "on";

const ONE_CHANNEL =
  "Necesitás al menos un canal: es como te enteramos si cancelamos o cambiamos un turno.";

// "Chrome · Android" from a user agent. Good enough to tell your own devices apart.
function describe(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Dispositivo", mobile: false };
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Navegador";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return {
    label: os ? `${browser} · ${os}` : browser,
    mobile: /iPhone|Android|Mobile/.test(ua),
  };
}

const EVENTS = [
  ["Reserva recibida", "Cuando reservás y falta el pago (solo por email)."],
  ["Turno confirmado", "Cuando se acredita el pago o usás una sesión."],
  ["Turno cancelado o reprogramado", "Si lo cancelás vos, o si VULL lo cancela o le cambia el horario."],
  ["Comprobante rechazado", "Si no pudimos verificar un pago que subiste."],
  ["Sesiones acreditadas", "Cuando se aprueba la compra de un pack."],
  ["Abono", "Cuota acreditada, lugar liberado y propuestas de intercambio."],
];

// Notification preferences + the devices that receive push.
//
// Two different things, kept visibly apart:
//   * the CHANNEL preference (profiles.notify_email / notify_push) — "do I want
//     this at all", applies everywhere;
//   * the DEVICE registration (push_subscriptions) — a browser has to subscribe
//     before it can receive anything, and can be removed on its own.
//
// At least one channel stays on (profiles_one_channel in the DB): the last one
// can't be switched off. Push only turns on once a device really subscribed
// (lib/push.ts verifies support, the installed app on iOS and permission
// first), so "push on" always means a device can receive it.
export function NotificationCenter({
  userId,
  email,
  initialEmail,
  initialPush,
  devices,
}: {
  userId: string;
  email: string | null;
  initialEmail: boolean;
  initialPush: boolean;
  devices: PushDevice[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [emailOn, setEmailOn] = useState(initialEmail);
  const [pushOn, setPushOn] = useState(initialPush);
  const [support, setSupport] = useState<Support>("loading");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    const problem = pushProblem();
    if (problem) return setSupport(problem === "dismissed" || problem === "failed" ? "off" : problem);
    const here = await currentEndpoint();
    setEndpoint(here);
    setSupport(here ? "on" : "off");
  }, []);

  useEffect(() => {
    // Browser-only capability probe: its result can't be known during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detect();
  }, [detect]);

  async function savePref(patch: { notify_email?: boolean; notify_push?: boolean }) {
    setError(null);
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) {
      // 23514 = profiles_one_channel: the DB refuses to leave no channel on.
      setError(error.code === "23514" ? ONE_CHANNEL : "No se pudo guardar. Probá de nuevo.");
      // Roll the optimistic toggle back so the UI matches the stored value.
      if (patch.notify_email !== undefined) setEmailOn(!patch.notify_email);
      if (patch.notify_push !== undefined) setPushOn(!patch.notify_push);
      return false;
    }
    return true;
  }

  // Subscribe THIS device; on success push is on (it can now be delivered).
  async function enableHere() {
    setBusy("here");
    setError(null);
    try {
      const res = await subscribeThisDevice(supabase, userId);
      if (!res.ok) {
        setError(PUSH_PROBLEM[res.problem]);
        await detect();
        return false;
      }
      setEndpoint(res.endpoint);
      setSupport("on");
      if (!pushOn) {
        setPushOn(true);
        await savePref({ notify_push: true });
      }
      router.refresh();
      return true;
    } finally {
      setBusy(null);
    }
  }

  // Turning push on needs a device that can receive it: one already
  // registered, or this one, verified and subscribed first. On failure the
  // preference stays off and the reason is shown.
  async function togglePush(on: boolean) {
    if (!on) {
      setPushOn(false);
      await savePref({ notify_push: false });
      return;
    }
    if (devices.length > 0) {
      setPushOn(true);
      await savePref({ notify_push: true });
      return;
    }
    await enableHere();
  }

  // Remove a device. For THIS browser that also means dropping the browser-side
  // subscription, or it would keep an endpoint the server no longer knows.
  async function remove(d: { id?: string; endpoint: string }) {
    const last = devices.length === 1;
    if (last && pushOn && !emailOn) {
      setError("Prendé el email antes de quitar tu último dispositivo: si no, no te llegaría ningún aviso.");
      return;
    }
    setBusy(d.endpoint);
    setError(null);
    try {
      if (d.endpoint === endpoint) {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        await sub?.unsubscribe();
        setEndpoint(null);
        setSupport("off");
      }
      const { error } = await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", userId)
        .eq("endpoint", d.endpoint);
      if (error) throw error;
      // No device left: push can't reach anyone, so say so in the preference.
      if (last && pushOn) {
        setPushOn(false);
        await savePref({ notify_push: false });
      }
      router.refresh();
    } catch {
      setError("No se pudo quitar el dispositivo.");
    } finally {
      setBusy(null);
    }
  }

  const hereRegistered = endpoint != null && devices.some((d) => d.endpoint === endpoint);
  // Push on but no device left (every one unsubscribed or expired) and email off.
  const silent = !emailOn && devices.length === 0;
  // The last channel on can't be switched off, nor email while push has no device.
  const emailLocked = emailOn && (!pushOn || devices.length === 0);
  const pushLocked = pushOn && !emailOn;

  return (
    <>
      {silent && (
        <p className="mb-6 rounded-md border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-300">
          Ningún dispositivo recibe tus avisos push. Activá este dispositivo o prendé el email.
          Si cancelamos o cambiamos un turno, te avisamos por email igual.
        </p>
      )}

      <Section
        title="Canales"
        description="Por dónde querés que te avisemos sobre tus turnos y sesiones."
      >
        <div className="surface-card divide-y divide-border">
          <SettingRow
            htmlFor="notify-email"
            label="Email"
            help={
              <>
                {email ? <span className="font-mono">{email}</span> : "Sin email cargado"}
                {emailLocked && <span className="mt-0.5 block">{ONE_CHANNEL}</span>}
              </>
            }
            control={
              <Switch
                id="notify-email"
                checked={emailOn}
                disabled={emailLocked}
                onCheckedChange={(v) => {
                  setEmailOn(v);
                  void savePref({ notify_email: v });
                }}
              />
            }
          />
          <SettingRow
            htmlFor="notify-push"
            label="Notificaciones push"
            help={
              pushLocked
                ? ONE_CHANNEL
                : !pushOn
                  ? "Apagadas. Al prenderlas activamos este dispositivo."
                  : devices.length === 0
                    ? "Activá al menos un dispositivo abajo"
                    : `En ${devices.length} ${devices.length === 1 ? "dispositivo" : "dispositivos"}`
            }
            control={
              <Switch
                id="notify-push"
                checked={pushOn}
                disabled={pushLocked || busy !== null}
                onCheckedChange={(v) => void togglePush(v)}
              />
            }
          />
        </div>
      </Section>

      <Section
        title="Dispositivos"
        description="Cada navegador o teléfono se activa por separado."
      >
        <div className="surface-card divide-y divide-border">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Este dispositivo</p>
              <p className="mt-0.5 text-xs text-fg-faint">
                {support === "loading" && "Comprobando…"}
                {support === "unsupported" && PUSH_PROBLEM.unsupported}
                {support === "needs_install" && PUSH_PROBLEM.needs_install}
                {support === "denied" && PUSH_PROBLEM.denied}
                {support === "off" && "Todavía no recibe avisos."}
                {support === "on" &&
                  (hereRegistered ? "Recibe avisos." : "Hay que volver a activarlo.")}
              </p>
            </div>
            {support === "on" && hereRegistered ? (
              <span className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.14em] text-accent">
                <Check className="size-3.5" aria-hidden /> Activo
              </span>
            ) : (
              (support === "off" || support === "on") && (
                <Button size="sm" onClick={() => void enableHere()} disabled={busy !== null}>
                  {busy === "here" ? "Activando…" : "Activar"}
                </Button>
              )
            )}
          </div>

          {devices.map((d) => {
            const { label, mobile } = describe(d.userAgent);
            const Icon = mobile ? Smartphone : Laptop;
            const here = d.endpoint === endpoint;
            return (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3.5">
                <Icon className="size-4 shrink-0 text-fg-faint" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    {label}
                    {here && <span className="text-fg-faint"> · este</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-faint">
                    Activo desde el {fmtDate(d.lastSeenAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-fg-muted hover:text-danger"
                  onClick={() => remove(d)}
                  disabled={busy !== null}
                >
                  {busy === d.endpoint ? "Quitando…" : "Quitar"}
                </Button>
              </div>
            );
          })}
        </div>
      </Section>

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}

      <Section title="Qué te avisamos">
        <ul className="surface-card divide-y divide-border">
          {EVENTS.map(([name, when]) => (
            <li key={name} className="px-5 py-3.5">
              <p className="text-sm font-medium text-fg">{name}</p>
              <p className="mt-0.5 text-xs text-fg-faint">{when}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-fg-faint">
          Son avisos sobre tus propios turnos. No enviamos publicidad. Si VULL cancela o
          cambia tu turno y ningún canal tuyo puede recibirlo, te avisamos por email igual.
        </p>
      </Section>
    </>
  );
}
