import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AmbientBackground } from "@/components/ui/ambient-background";
import { DEV_MODE, SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
import { DevModeBadge } from "@/components/dev-fake-payment";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Site-wide defaults (docs/seo.md). Pages set their own `title` (the template
// appends the brand); private and transactional routes add `robots: noindex`.
// The share image is app/opengraph-image.jpg, picked up by file convention.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // No `alternates.canonical` here: children inherit it, so every route would
  // claim to be "/". The indexable pages (/, /planes) set it themselves.
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      data-blur={process.env.NEXT_PUBLIC_BLUR_TEXT === "true" ? "" : undefined}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <AmbientBackground />
        <SiteHeader />
        <main className="relative z-0 flex-1">{children}</main>
        <SiteFooter />
        {DEV_MODE && <DevModeBadge />}
      </body>
    </html>
  );
}
