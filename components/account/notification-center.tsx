"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Laptop, Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fmtDate } from "@/lib/format";
import { Section, SettingRow } from "@/components/account/section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushDevice = {
  id: string;
  endpoint: string;
  userAgent: string | null;
  lastSeenAt: string;
};

// What this browser can do right now.
//   unsupported → no Web Push here (or VAPID not configured)
//   denied      → the user blocked the site's notifications in the browser
//   off / on    → can subscribe / is subscribed (see `endpoint`)
type Support = "loading" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

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
  ["Reserva recibida", "Cuando reservás y falta el pago."],
  ["Turno confirmado", "Cuando se acredita el pago o usás una sesión."],
  ["Turno cancelado", "Si lo cancelás vos o lo cancela VULL."],
  ["Sesiones acreditadas", "Cuando se aprueba la compra de un pack."],
];

// Notification preferences + the devices that receive push.
//
// Two different things, kept visibly apart:
//   * the CHANNEL preference (profiles.notify_email / notify_push) — "do I want
//     this at all", applies everywhere;
//   * the DEVICE registration (push_subscriptions) — a browser has to subscribe
//     before it can receive anything, and can be removed on its own.
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
    const supported =
      Boolean(VAPID) &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    if (!supported) return setSupport("unsupported");
    if (Notification.permission === "denied") return setSupport("denied");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setEndpoint(sub?.endpoint ?? null);
      setSupport(sub ? "on" : "off");
    } catch {
      setSupport("off");
    }
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
      setError("No se pudo guardar. Probá de nuevo.");
      // Roll the optimistic toggle back so the UI matches the stored value.
      if (patch.notify_email !== undefined) setEmailOn(!patch.notify_email);
      if (patch.notify_push !== undefined) setPushOn(!patch.notify_push);
    }
  }

  async function enableHere() {
    if (!VAPID) return;
    setBusy("here");
    setError(null);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setSupport(perm === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
      });
      const json = sub.toJSON();
      if (!json.keys) throw new Error("no keys");
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          user_id: userId,
          endpoint: sub.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      if (error) throw error;
      setEndpoint(sub.endpoint);
      setSupport("on");
      router.refresh();
    } catch {
      setError("No se pudo activar en este dispositivo.");
      await detect();
    } finally {
      setBusy(null);
    }
  }

  // Remove a device. For THIS browser that also means dropping the browser-side
  // subscription, or it would keep an endpoint the server no longer knows.
  async function remove(d: { id?: string; endpoint: string }) {
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
      router.refresh();
    } catch {
      setError("No se pudo quitar el dispositivo.");
    } finally {
      setBusy(null);
    }
  }

  const hereRegistered = endpoint != null && devices.some((d) => d.endpoint === endpoint);
  const silent = !emailOn && (!pushOn || devices.length === 0);

  return (
    <>
      {silent && (
        <p className="mb-6 rounded-md border border-amber-400/25 bg-amber-400/5 px-4 py-3 text-sm text-amber-300">
          Ahora no te llega ningún aviso. Vas a tener que entrar a la app para ver el estado
          de tus turnos.
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
            help={email ? <span className="font-mono">{email}</span> : "Sin email cargado"}
            control={
              <Switch
                id="notify-email"
                checked={emailOn}
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
              !pushOn
                ? "Apagadas en todos tus dispositivos"
                : devices.length === 0
                  ? "Activá al menos un dispositivo abajo"
                  : `En ${devices.length} ${devices.length === 1 ? "dispositivo" : "dispositivos"}`
            }
            control={
              <Switch
                id="notify-push"
                checked={pushOn}
                onCheckedChange={(v) => {
                  setPushOn(v);
                  void savePref({ notify_push: v });
                }}
              />
            }
          />
        </div>
      </Section>

      <Section
        title="Dispositivos"
        description="Cada navegador o teléfono se activa por separado."
      >
        <div
          className={`surface-card divide-y divide-border transition-opacity duration-150 ${
            pushOn ? "" : "opacity-50"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">Este dispositivo</p>
              <p className="mt-0.5 text-xs text-fg-faint">
                {support === "loading" && "Comprobando…"}
                {support === "unsupported" &&
                  "Este navegador no admite notificaciones push. En iPhone, agregá VULL a la pantalla de inicio y abrila desde ahí."}
                {support === "denied" &&
                  "Bloqueaste las notificaciones de este sitio. Habilitalas desde el candado de la barra de direcciones y recargá."}
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
                <Button size="sm" onClick={enableHere} disabled={busy !== null || !pushOn}>
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
          Son avisos sobre tus propios turnos. No enviamos publicidad.
        </p>
      </Section>
    </>
  );
}
