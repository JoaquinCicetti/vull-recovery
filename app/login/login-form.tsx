"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { createClient } from "@/lib/supabase/client";
import { Turnstile, isCaptchaEnabled } from "@/components/turnstile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    if (isCaptchaEnabled() && !captchaToken) {
      setError("Completá la verificación de seguridad.");
      return;
    }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        ...(captchaToken ? { captchaToken } : {}),
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setStep("code");
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Use the exact origin the user is on (e.g. https://www.vull.com.ar) so
        // Supabase honors this redirect instead of falling back to the Site URL
        // root. The host must be in the Supabase Redirect URLs allow-list.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // On success the browser redirects to Google; only reached on error.
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div>
      {step === "email" ? (
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={signInWithGoogle}
            disabled={loading}
            className="w-full gap-2.5"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
              />
            </svg>
            Continuar con Google
          </Button>

          <div className="flex items-center gap-3 text-xs text-fg-faint">
            <span className="h-px flex-1 bg-border" />o<span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <Label htmlFor="login-email" className="text-fg-muted">
              Email
            </Label>
            <Input
              id="login-email"
              type="email"
              required
              autoFocus
              placeholder="vos@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Turnstile onToken={setCaptchaToken} />
            <Button className="mt-1 w-full" disabled={loading}>
              {loading ? "Enviando…" : "Enviar código"}
            </Button>
          </form>
        </div>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          <Label className="text-fg-muted">Código enviado a {email}</Label>
          <InputOTP
            maxLength={8}
            pattern={REGEXP_ONLY_DIGITS}
            autoFocus
            required
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            onComplete={() => verify()}
            containerClassName="justify-center"
          >
            <InputOTPGroup className="gap-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <InputOTPSlot
                  key={i}
                  index={i}
                  className="size-10 rounded-md border-l bg-secondary font-mono text-base sm:size-11"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
          <Button className="mt-1 w-full" disabled={loading}>
            {loading ? "Verificando…" : "Ingresar"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-normal text-fg-faint hover:text-fg"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
          >
            Usar otro email
          </Button>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}
