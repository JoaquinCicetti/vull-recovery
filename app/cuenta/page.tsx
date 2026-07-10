import { requireUser } from "@/lib/auth";
import { getMyCredits } from "@/lib/credits";
import { ProfileForm } from "./profile-form";
import { CreditsSection } from "@/components/credits-section";
import { NotificationSettings } from "@/components/notification-settings";
import { PageShell } from "@/components/ui/page-shell";
import type { Profile } from "@/lib/types";

export default async function CuentaPage() {
  const { user, profile } = await requireUser("/cuenta");
  const credits = await getMyCredits();

  const initial: Profile = profile ?? {
    id: user!.id,
    full_name: null,
    whatsapp_phone: null,
    email: user!.email ?? null,
    is_admin: false,
    notify_email: true,
    notify_push: true,
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
      <CreditsSection credits={credits} />
      <div className="surface-card surface-lift animate-fade-up p-6">
        <ProfileForm profile={initial} />
      </div>
      <div className="surface-card surface-lift animate-fade-up mt-6 p-6">
        <NotificationSettings profile={initial} />
      </div>
    </PageShell>
  );
}
