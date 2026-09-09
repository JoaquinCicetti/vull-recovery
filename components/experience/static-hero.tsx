// Backdrop behind the WebGL experience — and, because <SceneBoundary> renders no
// fallback of its own, the no-WebGL fallback too. It therefore has to look
// deliberate on its own, with nothing composited on top.
//
// This used to be a blurred photograph (/vull-image-7.jpeg). It read as a stock
// plate under an art-directed 3D scene, and it was the homepage LCP element. It's
// now pure CSS — no image request, and the scene owns all the visuals. The JPEG
// itself stays in public/; components/landing/hero.tsx still uses it on /planes.
//
// Deliberately almost pure black. The canvas composites on top of this, and the
// 3D floor is #090c10 under near-black fog, so any lift here reads as a "sky"
// brighter than the ground — an inverted, washed-out room. Every gradient below
// is a soft radial with no hard stop, because a linear ramp puts a visible seam
// straight across the frame.
export function StaticHero() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      {/* Faint brand glow from the top — the same gesture as the body glow in globals.css. */}
      <div className="absolute inset-0 bg-[radial-gradient(58%_42%_at_50%_2%,rgba(97,179,59,0.07),transparent_72%)]" />
      {/* Low pool of light behind the product, so the bath has something to sit against. */}
      <div className="absolute inset-0 bg-[radial-gradient(70%_38%_at_50%_92%,rgba(24,34,28,0.55),transparent_74%)]" />
      {/* Film grain */}
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.1] mix-blend-overlay" />
      {/* Vignette */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_220px_70px_rgba(0,0,0,0.8)]" />
    </div>
  );
}
