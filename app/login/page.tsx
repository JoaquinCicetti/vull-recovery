import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col px-5 py-20">
      <p className="eyebrow">Acceso</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">
        Ingresá a tu cuenta
      </h1>
      <p className="mt-2 text-sm text-fg-muted">
        Te enviamos un código de 6 dígitos por email. Sin contraseñas.
      </p>
      <LoginForm next={next ?? "/"} />
    </div>
  );
}
