import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

// Loads /logo.svg and splits it by fill into the white mark and the single green
// check, dropping the black background tile. Shapes are in SVG space (576×576,
// y-down); the consumer applies the world transform.
//
// Only the MARK is returned — the wordmarks are excluded. Measured y-bands of
// the artwork:
//
//   mark   69–283   3 white paths + the green check
//   VULL  317–399   4 letters
//   LAB   419–463   3 letters + their near-black counters
//
// The spheres that morph into this are few (440 on mobile) and area-weighted, so
// sampling the ~0.15u-wide letter strokes spread them far too thin and the
// wordmark broke up. "VULL" is set as real DOM text instead — see
// components/experience/wordmark.tsx. The 34-unit gap between the mark and the
// first letter row makes a y-threshold an exact split, with no path indices or
// area heuristics to go stale if the SVG is re-exported.
export const LOGO_VIEWBOX = 576;
export const MARK_MAX_Y = 300;

export type LogoShapes = { white: THREE.Shape[]; green: THREE.Shape[] };

/** True for shapes above the wordmark rows (SVG space is y-down, so mark = small y). */
function isMark(shape: THREE.Shape): boolean {
  let maxY = -Infinity;
  for (const p of shape.getPoints(8)) if (p.y > maxY) maxY = p.y;
  return maxY < MARK_MAX_Y;
}

export async function loadLogoShapes(url = "/logo.svg"): Promise<LogoShapes> {
  const data = await new SVGLoader().loadAsync(url);
  const white: THREE.Shape[] = [];
  const green: THREE.Shape[] = [];

  for (const path of data.paths) {
    const c = path.color;
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (lum < 0.22) continue; // drop the black tile + near-black paths
    const isGreen = c.g > 0.35 && c.g > c.r * 1.15 && c.g > c.b * 1.15;
    const shapes = SVGLoader.createShapes(path).filter(isMark);
    (isGreen ? green : white).push(...shapes);
  }
  return { white, green };
}

/** Combined x/y bounding-box center of the mark in SVG space (for centering). */
export function shapesCenter(shapes: THREE.Shape[]): THREE.Vector2 {
  const box = new THREE.Box2();
  const v = new THREE.Vector2();
  for (const s of shapes) {
    for (const p of s.getPoints(8)) box.expandByPoint(v.set(p.x, p.y));
    for (const hole of s.holes)
      for (const p of hole.getPoints(8)) box.expandByPoint(v.set(p.x, p.y));
  }
  return box.getCenter(new THREE.Vector2());
}
