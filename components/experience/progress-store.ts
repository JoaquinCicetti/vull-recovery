import { create } from "zustand";

// Single source of truth for the experience timeline. ScrollTrigger writes
// `progress`; R3F reads it non-reactively inside useFrame via getState(), DOM
// overlays read it via a transient subscribe(). Never drive useFrame off React state.
type ProgressState = {
  progress: number;
  setProgress: (p: number) => void;
};

export const useProgressStore = create<ProgressState>((set) => ({
  progress: 0,
  setProgress: (progress) => set({ progress }),
}));
