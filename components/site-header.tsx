import Link from "next/link";
import { getUserAndProfile } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { SiteChrome } from "@/components/landing/site-chrome";
import { Button } from "@/components/ui/button";

export async function SiteHeader() {
  const { user, profile } = await getUserAndProfile();

  return (
    <SiteChrome>
      <Link
        href="/"
        aria-label="Inicio"
        className="transition-opacity hover:opacity-80"
      >
        <Logo imgClassName="h-12" />
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {user ? (
          <>
            <Link
              href="/mis-turnos"
              className="rounded-lg px-3 py-2 text-fg-muted transition-colors hover:text-fg"
            >
              Mis turnos
            </Link>
            {profile?.is_admin && (
              <Link
                href="/admin"
                className="rounded-lg px-3 py-2 text-fg-muted transition-colors hover:text-fg"
              >
                Admin
              </Link>
            )}
            <Button asChild variant="outline" className="ml-1">
              <Link href="/cuenta">Mi cuenta</Link>
            </Button>
          </>
        ) : (
          <Button asChild>
            <Link href="/login">Ingresar</Link>
          </Button>
        )}
      </nav>
    </SiteChrome>
  );
}
