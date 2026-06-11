import { getActiveServices } from "@/lib/services";
import { waLink, SITE_NAME } from "@/lib/site";
import { Logo } from "@/components/logo";
import { Hero } from "@/components/landing/hero";
import { RecoveryJourney } from "@/components/landing/recovery-journey";
import { Plans } from "@/components/landing/plans";

export default async function Home() {
  const services = await getActiveServices();

  return (
    <>
      <Hero />
      <RecoveryJourney />
      <Plans services={services} />

      {/* Footer */}
      <footer className="border-t border-border bg-black">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 px-5 py-12 sm:flex-row">
          <Logo withWordmark />
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg-faint">
            © {new Date().getFullYear()} {SITE_NAME} · Recuperación deportiva
          </span>
          <a
            href={waLink("Hola!")}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-fg-muted transition-colors hover:text-accent"
          >
            WhatsApp
          </a>
        </div>
      </footer>
    </>
  );
}
