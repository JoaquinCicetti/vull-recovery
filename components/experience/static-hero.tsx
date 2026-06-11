import Image from "next/image";

// Fixed hero image behind the experience. The source is low-res, so it's slightly
// scaled + blurred + graded with gradients, grain and a vignette to read as an
// intentional cinematic backdrop rather than a sharp photo. The Scrim above darkens
// it toward black as the spheres rise.
//
// This is the homepage LCP element, so it's served through next/image (priority +
// AVIF/WebP + responsive sizing) rather than a raw <img> of the full JPEG. It's
// blurred anyway, so a lower quality is imperceptible and saves bytes.
export function StaticHero() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <Image
        src="/vull-image-7.jpeg"
        alt=""
        aria-hidden="true"
        fill
        priority
        sizes="100vw"
        quality={40}
        style={{ transform: "scale(1.12) translateY(-5%)" }}
        className="object-cover [filter:blur(3px)_saturate(1.05)_contrast(1.06)_brightness(0.9)]"
      />
      {/* depth + legibility gradients */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/85" />
      {/* faint brand glow from the top */}
      <div className="absolute inset-0 bg-[radial-gradient(60%_45%_at_50%_6%,rgba(97,179,59,0.1),transparent_70%)]" />
      {/* film grain */}
      <div className="bg-noise pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay" />
      {/* vignette */}
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_220px_70px_rgba(0,0,0,0.75)]" />
    </div>
  );
}
