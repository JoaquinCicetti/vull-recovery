import * as THREE from "three";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadLogoShapes, shapesCenter, LOGO_VIEWBOX } from "./logo-loader";

// Bake `count` target positions sampled across the mark (area-weighted), each with
// a tint (white for the triangle/wordmark, green for the check). Spheres morph to
// these in Phase E. World transform: scale to ~7u, flip Y, center on the mark.
const WORLD = 4.6 / LOGO_VIEWBOX;

export type LogoTargets = { positions: Float32Array; tints: Float32Array };

export async function sampleLogoTargets(count: number): Promise<LogoTargets> {
  const { white, green } = await loadLogoShapes();
  const center = shapesCenter([...white, ...green]);

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
    positions[i * 3 + 1] = -(p.y - center.y) * WORLD; // flip SVG y-down → world y-up
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.05; // nearly flat → crisp silhouette
    tints[i * 3] = col.r;
    tints[i * 3 + 1] = col.g;
    tints[i * 3 + 2] = col.b;
  }
  return { positions, tints };
}
