import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import { SettlementPoller } from "@/components/settlement-poller";

// Landing page after a pack purchase, reached as ?ref=<payment id> (Talo's
// redirect_url, and the "Ya transferí" button on the purchase panel).
//
// The webhook grants the credits once it has re-verified the payment with Talo,
// but the browser can land here first — and a bank transfer settles asynchronously
// anyway. So read the payment, only offer a booking link once it is actually
// `approved` (otherwise /reservar would find a zero balance and bounce the buyer
// straight back to /comprar), and keep refreshing until it is. Reading a pack
// payment relies on the `payments.user_id = auth.uid()` arm of payments_select_own.
export default async function CompraExitoPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  let approvedServiceId: string | null = null;
  let stillPending = false;
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
    stillPending = data?.status === "pending";
  }

  return (
    <PageShell
      ambient
      eyebrow="Compra"
      title="¡Listo!"
      description={
        approvedServiceId
          ? "Tus sesiones ya están acreditadas. Reservá la primera cuando quieras."
          : "Estamos esperando que se acredite la transferencia. En cuanto entra, tus sesiones quedan disponibles acá mismo y por email."
      }
    >
      <SettlementPoller active={stillPending} />
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
