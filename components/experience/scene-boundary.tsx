"use client";

import { Component, type ReactNode } from "react";

/**
 * Error boundary for anything that touches WebGL.
 *
 * `<Canvas>` builds a WebGLRenderer inside a layout effect, and `useGLTF` throws
 * a real error (not a promise) when the model 404s — neither is caught by
 * `<Suspense>`. With no boundary anywhere in `app/`, either one unmounted the
 * whole React root and Next replaced the entire homepage — hero, CTAs, plans, the
 * complete conversion path — with its generic English "Application error" screen.
 *
 * Failure cases seen in the wild: hardware acceleration off, a blocklisted GPU,
 * too many live contexts, a stale HTML shell pointing at a deployed-away chunk,
 * and `webglcontextlost` after a thermal reset on a phone.
 *
 * `onError` lets the caller un-jack the scroll, so a dead scene can never leave
 * the visitor trapped on a black screen that will not scroll.
 */
export class SceneBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; onError?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // Not user-actionable — the fallback is the product. Log for triage only.
    console.error("[experience] scene failed, falling back:", error);
    this.props.onError?.();
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
