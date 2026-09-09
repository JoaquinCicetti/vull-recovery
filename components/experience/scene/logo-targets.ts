import * as THREE from "three";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadLogoShapes, shapesCenter } from "./logo-loader";

// Bake `count` target positions sampled across the mark (area-weighted), each with
// a tint (white for the triangle, green for the check). Spheres morph to these in
// Phase E. World transform: flip Y, center on the mark.
//
// loadLogoShapes now returns the MARK ONLY (no wordmarks), which is 214 SVG units
// tall instead of the full lockup's 394 — hence the larger WORLD, so the mark
// still fills a comparable share of the frame. Every sphere now packs into the
// mark instead of being spread across seven thin letters, so density roughly
// doubles; that is what fixes the broken look at the 440-sphere mobile count.
// "VULL" is set as DOM text beneath it (components/experience/wordmark.tsx).
// The mark is measured, not guessed: it spans 253 × 214 SVG units (x 164–417,
// y 69–283), a 1.18 aspect.
const MARK_W = 253;
const MARK_H = 214;

// The assembly is framed by a FIXED final camera — (0,0,13.5) aimed at the
// origin, fov 24 — so the visible world height there is a constant
// 2 × 13.5 × tan(12°) ≈ 5.74, and the visible WIDTH is that times the viewport
// aspect. On a phone (aspect ≈0.46) the width budget is only ~2.65 world units,
// so a mark sized for desktop overflows and clips against both edges. Size it
// against whichever axis is tighter.
function markHeight(): number {
  const aspect =
    typeof window === "undefined" ? 16 / 9 : window.innerWidth / window.innerHeight;
  const visibleH = 2 * 13.5 * Math.tan((12 * Math.PI) / 180);
  const visibleW = visibleH * aspect;
  // Occupy ~68% of the width budget, and never exceed 2.6u tall on wide screens.
  return Math.min(2.6, (visibleW * 0.68) / (MARK_W / MARK_H));
}

export type LogoTargets = { positions: Float32Array; tints: Float32Array };

export async function sampleLogoTargets(count: number): Promise<LogoTargets> {
  const { white, green } = await loadLogoShapes();
  const center = shapesCenter([...white, ...green]);

  const height = markHeight();
  const WORLD = height / MARK_H;
  // Lift proportionally, so the mark's lower edge lands just under 58% of the
  // viewport at every aspect and the DOM wordmark below it always clears.
  const LOGO_Y = height * 0.33;

  const geos: THREE.BufferGeometry[] = [];
  const addShapes = (shapes: THREE.Shape[], color: THREE.Color) => {
    for (const shape of shapes) {
      const g = new THREE.ShapeGeometry(shape);
      const n = g.attributes.position.count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geos.push(g);
    }
  };
  addShapes(white, new THREE.Color(0.96, 0.98, 0.96));
  addShapes(green, new THREE.Color("#6CCB45"));

  const merged = mergeGeometries(geos, false);
  if (!merged) throw new Error("logo merge failed");
  const sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build();

  const positions = new Float32Array(count * 3);
  const tints = new Float32Array(count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const col = new THREE.Color();

  for (let i = 0; i < count; i++) {
    sampler.sample(p, n, col);
    positions[i * 3] = (p.x - center.x) * WORLD;
    positions[i * 3 + 1] = -(p.y - center.y) * WORLD + LOGO_Y; // flip y + lift up
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.025; // nearly flat → crisp silhouette
    tints[i * 3] = col.r;
    tints[i * 3 + 1] = col.g;
    tints[i * 3 + 2] = col.b;
  }
  return { positions, tints };
}
