import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  NotificationCenter,
  type PushDevice,
} from "@/components/account/notification-center";
import { PageShell } from "@/components/ui/page-shell";

export default async function NotificacionesPage() {
  const { user, profile } = await requireUser("/cuenta/notificaciones");
  const supabase = await createClient();
  const { data } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, user_agent, last_seen_at")
    .eq("user_id", user!.id)
    .order("last_seen_at", { ascending: false });

  const devices: PushDevice[] = (data ?? []).map((d) => ({
    id: d.id as string,
    endpoint: d.endpoint as string,
    userAgent: (d.user_agent as string) ?? null,
    lastSeenAt: d.last_seen_at as string,
  }));

  return (
    <PageShell size="wide" top="tight" eyebrow="Tu cuenta" title="Avisos">
      <NotificationCenter
        userId={user!.id}
        email={profile?.email ?? user!.email ?? null}
        initialEmail={profile?.notify_email ?? true}
        initialPush={profile?.notify_push ?? false}
        devices={devices}
      />
    </PageShell>
  );
}
