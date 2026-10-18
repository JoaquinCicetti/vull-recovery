"use client";

import type { createClient } from "@/lib/supabase/client";

// Web Push from the browser side: can this device receive push, and subscribe
// it. Shared by the client's notification preferences
// (components/account/notification-center.tsx) and the admin's button
// (components/push-manager.tsx), so both verify the same way before anything
// is stored.
//
// A device counts as able only when it really is: the VAPID key is configured,
// the browser has a service worker, PushManager and Notification, and, on an
// iPhone/iPad, VULL runs as the installed app (Safari in a tab has no push).

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushProblem = "unsupported" | "needs_install" | "denied" | "dismissed" | "failed";

/** Spanish, one line each: why push can't be turned on here. */
export const PUSH_PROBLEM: Record<PushProblem, string> = {
  unsupported: "Este navegador no admite notificaciones push.",
  needs_install:
    "En iPhone y iPad los avisos llegan solo con la app instalada: tocá Compartir → Agregar a inicio, abrila desde ahí y activalos.",
  denied:
    "Bloqueaste las notificaciones de este sitio. Habilitalas desde el candado de la barra de direcciones y recargá.",
  dismissed: "No diste permiso para las notificaciones.",
  failed: "No se pudo activar en este dispositivo. Probá de nuevo.",
};

function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

/** What stops this device from receiving push, or null when it can. Call only
 *  in the browser (an effect or an event handler). */
export function pushProblem(): PushProblem | null {
  if (!VAPID) return "unsupported";
  // Checked first: Safari in a tab also lacks PushManager, and "install the
  // app" is the actionable answer there.
  if (isIOS() && !isStandalone()) return "needs_install";
  if (!("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  return null;
}

/** This browser's current subscription endpoint, if it has one. */
export async function currentEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verify, ask permission, subscribe and STORE this device's subscription
 * (push_subscriptions, own-row RLS). Only an `ok` result means the server can
 * reach this device; callers turn notify_push on after it, never before.
 */
export async function subscribeThisDevice(
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ ok: true; endpoint: string } | { ok: false; problem: PushProblem }> {
  const problem = pushProblem();
  if (problem) return { ok: false, problem };
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, problem: perm === "denied" ? "denied" : "dismissed" };
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID!) as BufferSource,
    });
    const json = sub.toJSON();
    if (!json.keys) return { ok: false, problem: "failed" };
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
    if (error) return { ok: false, problem: "failed" };
    return { ok: true, endpoint: sub.endpoint };
  } catch {
    return { ok: false, problem: "failed" };
  }
}
