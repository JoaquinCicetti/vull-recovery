import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";

// Mobbex return_url after a pack purchase, reached as ?ref=<payment id>.
//
// The webhook grants the credits once it has re-verified the payment with Mobbex,
// but the browser can land here first. So read the payment and only offer a booking
// link once it is actually `approved` — otherwise /reservar would find a zero
// balance and bounce the buyer straight back to /comprar. Reading a pack payment
// relies on the `payments.user_id = auth.uid()` arm of payments_select_own.
export default async function CompraExitoPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  let approvedServiceId: string | null = null;
  if (ref) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("payments")
      .select("status, service_id")
      .eq("id", ref)
      .maybeSingle();
    if (data?.status === "approved" && data.service_id) {
      approvedServiceId = data.service_id as string;
    }
  }

  return (
    <PageShell
      ambient
      eyebrow="Compra"
      title="¡Listo!"
      description={
        approvedServiceId
          ? "Tus sesiones ya están acreditadas. Reservá la primera cuando quieras."
          : "Estamos acreditando tus sesiones. En cuanto se aprueba el pago vas a poder reservar cada turno con un crédito."
      }
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          {approvedServiceId ? (
            <Link href={`/reservar/${approvedServiceId}`}>
              Reservar tu primera sesión
            </Link>
          ) : (
            <Link href="/mis-turnos">Ver mis créditos</Link>
          )}
        </Button>
        <Button asChild variant="outline">
          <Link href="/#planes">Volver a planes</Link>
        </Button>
      </div>
    </PageShell>
  );
}
