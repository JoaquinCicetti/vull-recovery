// Shared scroll hook so UI (the hero CTA) can run the whole animation down to the
// plans. The experience registers a scroller; fallback is a plain smooth scroll.
let scroller: (() => void) | null = null;

export function setScroller(fn: (() => void) | null) {
  scroller = fn;
}

export function scrollToPlans() {
  if (scroller) scroller();
  else document.getElementById("planes")?.scrollIntoView({ behavior: "smooth" });
}
