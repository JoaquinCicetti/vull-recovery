"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Enables Web Push for the admin device: registers the service worker, subscribes
// with the VAPID public key, and upserts the subscription (own-row RLS). Renders
// nothing when Web Push isn't available or NEXT_PUBLIC_VAPID_PUBLIC_KEY is unset,
// so the panel is unchanged until push is configured.
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "off" | "denied" | "on" | "working";

export function PushManager() {
  const supabase = createClient();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    const supported =
      Boolean(VAPID) &&
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    (async () => {
      if (!supported) {
        if (!cancelled) setState("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (!cancelled) setState(sub ? "on" : "off");
      } catch {
        if (!cancelled) setState("off");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    if (!VAPID) return;
    setState("working");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
      });
      const json = sub.toJSON();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !json.keys) {
        setState("off");
        return;
      }
      await supabase.from("push_subscriptions").upsert(
        {
          user_id: user.id,
          endpoint: sub.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
          user_agent: navigator.userAgent,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
      setState("on");
    } catch {
      setState("off");
    }
  }

  if (state === "unsupported" || state === "loading") return null;
  if (state === "on") {
    return (
      <p className="font-mono text-xs text-fg-faint">
        🔔 Notificaciones activadas en este dispositivo
      </p>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={enable}
      disabled={state === "working"}
    >
      {state === "working"
        ? "Activando…"
        : state === "denied"
          ? "Permiso denegado — activalo en el navegador"
          : "Activar notificaciones en este dispositivo"}
    </Button>
  );
}
