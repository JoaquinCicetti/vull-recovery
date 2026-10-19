import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't infer it from stray lockfiles elsewhere.
  turbopack: {
    root: __dirname,
  },
  images: {
    // Serve AVIF (then WebP) instead of the original JPEGs — large savings on the
    // facility photography. Optimized variants are immutable, so cache them for a year.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 31536000,
  },
  // The backoffice was reorganised by sector (Agenda / Pagos / Clientes /
  // Métricas / Ajustes). Old bookmarks and docs keep working.
  async redirects() {
    return [
      { source: "/admin/turnos", destination: "/admin/agenda?ver=turnos", permanent: false },
      { source: "/admin/abonos", destination: "/admin/agenda?ver=abonos", permanent: false },
      { source: "/admin/servicios", destination: "/admin/ajustes", permanent: false },
      { source: "/admin/configuracion", destination: "/admin/ajustes", permanent: false },
    ];
  },
};

export default nextConfig;
