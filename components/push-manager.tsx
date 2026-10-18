"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { currentEndpoint, PUSH_PROBLEM, type PushProblem, pushProblem, subscribeThisDevice } from "@/lib/push";
import { Button } from "@/components/ui/button";

// Enables Web Push for the admin device: verifies the browser can receive it
// (lib/push.ts), registers the service worker, subscribes with the VAPID public
// key, and upserts the subscription (own-row RLS). Renders nothing when this
// browser can't do push at all, so the panel is unchanged until push is
// configured; on an iPhone outside the installed app it says how to install.
type State = "loading" | "hidden" | "off" | "on" | "working" | PushProblem;

export function PushManager() {
  const supabase = createClient();
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const problem = pushProblem();
      const next: State = problem === "unsupported"
        ? "hidden"
        : problem ?? ((await currentEndpoint()) ? "on" : "off");
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setState("working");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setState("off");
    const res = await subscribeThisDevice(supabase, user.id);
    setState(res.ok ? "on" : res.problem);
  }

  if (state === "hidden" || state === "loading") return null;
  if (state === "on") {
    return (
      <p className="font-mono text-xs text-fg-faint">
        🔔 Notificaciones activadas en este dispositivo
      </p>
    );
  }
  if (state === "needs_install" || state === "denied" || state === "unsupported") {
    return <p className="text-xs text-fg-faint">{PUSH_PROBLEM[state]}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" onClick={enable} disabled={state === "working"}>
        {state === "working" ? "Activando…" : "Activar notificaciones en este dispositivo"}
      </Button>
      {(state === "dismissed" || state === "failed") && (
        <span className="text-xs text-fg-faint">{PUSH_PROBLEM[state]}</span>
      )}
    </div>
  );
}
