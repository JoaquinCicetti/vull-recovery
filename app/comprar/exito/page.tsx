import Link from "next/link";
import { PageShell } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";

// Mobbex return_url after a pack purchase. Credits are granted by the webhook on
// approval, so this just confirms the purchase is being processed.
export default function CompraExitoPage() {
  return (
    <PageShell
      ambient
      eyebrow="Compra"
      title="¡Listo!"
      description="Estamos acreditando tus sesiones. En cuanto se aprueba el pago vas a poder reservar cada turno con un crédito."
    >
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/mis-turnos">Ver mis créditos</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/#planes">Volver a planes</Link>
        </Button>
      </div>
    </PageShell>
  );
}
