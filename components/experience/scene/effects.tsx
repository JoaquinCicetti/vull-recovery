"use client";

import { useEffect, useState } from "react";
import {
  EffectComposer,
  Bloom,
  Vignette,
  Noise,
  DepthOfField,
} from "@react-three/postprocessing";
import { useProgressStore } from "../progress-store";
import { PHASES, phaseLocal } from "@/lib/experience/config";

// Postprocessing grade. Bloom catches the sphere/check speculars; vignette + grain
// for cinematic cohesion. DepthOfField (the costliest pass — CoC + bokeh at render
// resolution) is mounted ONLY during the logo-assembly reveal, and never on the
// low performance tier, so the long rise doesn't pay for it. Two full trees so the
// conditional pass never breaks the composer's pass chain.
export function Effects({ dof = true, lowTier = false }: { dof?: boolean; lowTier?: boolean }) {
  const [assembling, setAssembling] = useState(() =>
    phaseLocal(useProgressStore.getState().progress, PHASES.assembly) > 0.001,
  );
  useEffect(() => {
    return useProgressStore.subscribe((s) =>
      setAssembling(phaseLocal(s.progress, PHASES.assembly) > 0.001),
    );
  }, []);

  const ms = lowTier ? 0 : 2;

  if (dof && assembling && !lowTier) {
    return (
      <EffectComposer multisampling={ms}>
        <DepthOfField focusDistance={0.012} focalLength={0.05} bokehScale={2.4} />
        <Bloom intensity={0.5} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.28} darkness={0.72} />
        <Noise opacity={0.04} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer multisampling={ms}>
      <Bloom intensity={0.5} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur />
      <Vignette offset={0.28} darkness={0.72} />
      <Noise opacity={0.04} />
    </EffectComposer>
  );
}
