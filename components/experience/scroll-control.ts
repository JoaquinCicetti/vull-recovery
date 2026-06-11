import type Lenis from "lenis";

// Shared handle to the experience's Lenis instance so UI (e.g. the hero CTA) can
// drive a smooth scroll that runs the whole animation, then settles on the plans.
let lenis: Lenis | null = null;

export function setLenis(instance: Lenis | null) {
  lenis = instance;
}

// Smooth-scroll to the plans section below the pinned stage, running the ball
// animation on the way down.
export function scrollToPlans() {
  if (lenis) {
    lenis.scrollTo("#planes", { duration: 3.4 });
  } else {
    document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" });
  }
}
