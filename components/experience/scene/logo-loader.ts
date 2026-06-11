import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

// Loads /logo.svg and splits it by fill into the white mark (triangle + VULL LAB
// wordmark) and the single green check, dropping the black background tile. Shapes
// are in SVG space (576×576, y-down); the consumer applies the world transform.
export const LOGO_VIEWBOX = 576;

export type LogoShapes = { white: THREE.Shape[]; green: THREE.Shape[] };

export async function loadLogoShapes(url = "/logo.svg"): Promise<LogoShapes> {
  const data = await new SVGLoader().loadAsync(url);
  const white: THREE.Shape[] = [];
  const green: THREE.Shape[] = [];

  for (const path of data.paths) {
    const c = path.color;
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (lum < 0.22) continue; // drop the black tile + near-black paths
    const isGreen = c.g > 0.35 && c.g > c.r * 1.15 && c.g > c.b * 1.15;
    const shapes = SVGLoader.createShapes(path);
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
