import { requireUser } from "@/lib/auth";
import { ProfileForm } from "./profile-form";
import { PageShell } from "@/components/ui/page-shell";
import type { Profile } from "@/lib/types";

export default async function CuentaPage() {
  const { user, profile } = await requireUser("/cuenta");

  const initial: Profile = profile ?? {
    id: user!.id,
    full_name: null,
    whatsapp_phone: null,
    is_admin: false,
  };

  return (
    <PageShell
      size="narrow"
      eyebrow="Tu cuenta"
      title="Mi cuenta"
      description={
        <span className="font-mono text-fg-faint">{user!.email}</span>
      }
    >
      <div className="surface-card surface-lift animate-fade-up p-6">
        <ProfileForm profile={initial} />
      </div>
    </PageShell>
  );
}
