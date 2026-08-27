"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";

// Route-level error boundary. Previously ANY thrown error — Supabase unreachable,
// a failed server fetch, a WebGL construction failure on the landing — unmounted
// the React root and Next replaced the whole page with its generic English
// "Application error: a client-side exception has occurred".
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error);
  }, [error]);

  return (
    <PageShell
      eyebrow="Algo salió mal"
      title="No pudimos cargar esta página"
      description="Puede ser un problema momentáneo de conexión. Probá de nuevo; si sigue igual, escribinos y lo resolvemos."
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Button onClick={reset}>Reintentar</Button>
        <Button asChild variant="outline">
          <Link href="/#planes">Volver a planes</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="mt-6 font-mono text-xs text-fg-faint">
          Referencia: {error.digest}
        </p>
      )}
    </PageShell>
  );
}
