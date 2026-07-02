import type { MetadataRoute } from "next";

// PWA manifest — needed for installability (and for iOS to allow Web Push, which
// requires the site be added to the home screen). Next auto-serves this at
// /manifest.webmanifest and injects the <link rel="manifest">.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VULL — Recuperación deportiva",
    short_name: "VULL",
    description: "Reservá y pagá tu sesión de recuperación.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#61B33B",
    icons: [
      { src: "/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
