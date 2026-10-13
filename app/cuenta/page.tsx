import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { ProfileForm, SignOutButton } from "./profile-form";
import { AccountTabs } from "@/components/account/account-tabs";
import { Section } from "@/components/account/section";
import { PageShell } from "@/components/ui/page-shell";

function initials(name: string | null, email: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email ?? "?").slice(0, 2).toUpperCase();
}

export default async function CuentaPage() {
  const { user, profile } = await requireUser("/cuenta");
  const email = profile?.email ?? user!.email ?? null;
  const name = profile?.full_name ?? null;

  return (
    <PageShell nav={<AccountTabs />} eyebrow="Tu cuenta" title="Perfil">
      <div className="surface-card surface-lift animate-fade-up flex items-center gap-4 p-5">
        <div
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 font-mono text-lg font-bold text-accent"
        >
          {initials(name, email)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-fg">{name || "Sin nombre"}</p>
          <p className="truncate font-mono text-sm text-fg-muted">{email}</p>
          <p className="mt-1 text-xs text-fg-faint">
            Cliente desde el {fmtDate(user!.created_at)}
            {profile?.is_admin && " · Administrador"}
          </p>
        </div>
      </div>

      <Section
        title="Tus datos"
        description="Los usamos para identificar tus turnos y coordinar por WhatsApp."
      >
        <div className="surface-card p-5">
          <ProfileForm
            userId={user!.id}
            fullName={name}
            phone={profile?.whatsapp_phone ?? null}
          />
        </div>
      </Section>

      <Section
        title="Acceso"
        description="Entrás con un código que te enviamos a tu email, o con Google. No hay contraseña que recordar."
      >
        <div className="surface-card flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">Sesión iniciada</p>
            <p className="mt-0.5 truncate font-mono text-xs text-fg-faint">{email}</p>
          </div>
          <SignOutButton />
        </div>
      </Section>
    </PageShell>
  );
}
