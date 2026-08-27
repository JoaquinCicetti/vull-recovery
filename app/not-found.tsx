import Link from "next/link";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";

// Spanish 404 inside the app chrome. Without this, a stale plan link, a
// deactivated service or a typo'd turno id rendered Next's built-in English
// "404 | This page could not be found" — no header, no footer, no way back.
export default function NotFound() {
  return (
    <PageShell
      eyebrow="Error 404"
      title="No encontramos esta página"
      description="El enlace puede estar vencido o el plan ya no está disponible."
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/#planes">Ver los planes</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/mis-turnos">Mis turnos</Link>
        </Button>
      </div>
    </PageShell>
  );
}
