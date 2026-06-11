// Shared easing — mirrors the CSS tokens (--ease-out-expo / --ease-out-quart).
// Rule: nothing linear except continuous idle drift and grain. Slow ease-outs.

export const E = {
  linear: (x: number) => x,
  expoOut: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)), // entrances, camera
  quartOut: (x: number) => 1 - Math.pow(1 - x, 4),
  quintOut: (x: number) => 1 - Math.pow(1 - x, 5), // assembly arrivals
  inOutSine: (x: number) => -(Math.cos(Math.PI * x) - 1) / 2, // drift, dolly
  inOutExpo: (x: number) =>
    x === 0 ? 0 : x === 1 ? 1 : x < 0.5
      ? Math.pow(2, 20 * x - 10) / 2
      : (2 - Math.pow(2, -20 * x + 10)) / 2, // camera through V
  backOut: (x: number, s = 1.05) =>
    1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2), // settle
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
