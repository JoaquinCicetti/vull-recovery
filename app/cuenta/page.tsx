import { requireUser } from "@/lib/auth";
import { ProfileForm } from "./profile-form";
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
    <div className="mx-auto max-w-md px-5 py-16">
      <p className="eyebrow">Tu cuenta</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Mi cuenta</h1>
      <p className="mt-2 font-mono text-sm text-fg-faint">{user!.email}</p>
      <ProfileForm profile={initial} />
    </div>
  );
}
