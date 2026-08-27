"use client";

// Last-resort boundary: catches failures in the root layout itself, where
// app/error.tsx cannot render because it lives *inside* that layout. Must ship
// its own <html>/<body>, so it deliberately uses inline styles rather than the
// app's CSS (which may be exactly what failed).
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <div>
          <p
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "#7d7d7d",
            }}
          >
            VULL
          </p>
          <h1 style={{ margin: "0.75rem 0 0", fontSize: "1.5rem" }}>
            No pudimos cargar el sitio
          </h1>
          <p style={{ color: "#9a9a9a", marginTop: "0.5rem" }}>
            Probá de nuevo en un momento.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              background: "#61B33B",
              color: "#0A0F08",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.75rem 1.25rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
