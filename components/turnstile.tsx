"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile (free bot protection) for the OTP/login flow. Entirely
// inert unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set: <Turnstile> renders nothing
// and isCaptchaEnabled() is false, so login behaves exactly as before. Turn it on
// by setting the site key here AND enabling [auth.captcha] in supabase/config.toml
// with TURNSTILE_SECRET (see docs/setup.md "Bot protection").

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
    },
  ) => string;
  reset: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function isCaptchaEnabled(): boolean {
  return Boolean(SITE_KEY);
}

export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || rendered.current || !ref.current || !window.turnstile) return;
      rendered.current = true;
      window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: "dark",
        callback: (t) => onToken(t),
        "error-callback": () => onToken(null),
        "expired-callback": () => onToken(null),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      );
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", render);
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="flex justify-center" />;
}
