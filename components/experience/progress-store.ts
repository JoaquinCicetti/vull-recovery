import { create } from "zustand";

// Single source of truth for the experience timeline. ScrollTrigger writes
// `progress`; R3F reads it non-reactively inside useFrame via getState(), DOM
// overlays read it via a transient subscribe(). Never drive useFrame off React state.
// `introAt` is the entry-animation clock, deliberately kept OUT of `progress`: the
// entrance is time-driven and one-shot, the ride is scroll-driven and reversible, so
// the damped scroll loop can never overwrite it and it can never fight the spline.
// Null means "still behind the loading veil" — the scene renders unlit and far back.
type ProgressState = {
  progress: number;
  setProgress: (p: number) => void;
  introAt: number | null;
  beginIntro: () => void;
};

export const useProgressStore = create<ProgressState>((set, get) => ({
  progress: 0,
  setProgress: (progress) => set({ progress }),
  introAt: null,
  // Idempotent: fired both when the loader reports 100% and by the hard safety
  // timeout, whichever comes first. A second call must not restart the entrance.
  beginIntro: () => {
    if (get().introAt === null) set({ introAt: performance.now() });
  },
}));
