import { LoginForm } from "./login-form";
import { PageShell } from "@/components/ui/page-shell";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <PageShell
      size="narrow"
      eyebrow="Acceso"
      title="Ingresá a tu cuenta"
      description="Te enviamos un código de 6 dígitos por email. Sin contraseñas."
    >
      <div className="surface-card surface-lift animate-fade-up p-6">
        <LoginForm next={next ?? "/"} />
      </div>
    </PageShell>
  );
}
