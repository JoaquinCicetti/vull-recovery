import Link from "next/link";
import { getUserAndProfile } from "@/lib/auth";
import { Logo } from "@/components/logo";

export async function SiteHeader() {
  const { user, profile } = await getUserAndProfile();

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/75 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3">
        <Link href="/" aria-label="Inicio" className="transition-opacity hover:opacity-80">
          <Logo />
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
              <Link href="/cuenta" className="btn-ghost ml-1">
                Mi cuenta
              </Link>
            </>
          ) : (
            <Link href="/login" className="btn-primary">
              Ingresar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
