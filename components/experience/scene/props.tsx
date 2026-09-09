"use client";

/* eslint-disable react-hooks/immutability --
   Procedural WebGL: useFrame writes shader uniforms and material opacity every
   frame by design; the React Compiler immutability rule doesn't model this. */

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { useProgressStore } from "../progress-store";
import { makeMat } from "./volumetric";

// The studio around the bath: a sauna cabin, compression boots on a bench, a
// red-light panel, a shelf of towels, and a foam roller in the foreground.
// Deliberately BACKGROUND — the bath is the product and stays dominant.
//
// Everything is built from Three primitives. No GLB, no textures, no new bytes.
//
// Craft notes, because the first pass read as programmer art:
//
// * EVERY box is a RoundedBoxGeometry. A hard 90° corner has no width to catch a
//   highlight, so it dies to a flat silhouette and reads as an untextured
//   primitive. A 3-6cm bevel gives each edge a specular line and is most of the
//   difference between "CG box" and "object".
// * FOUR materials, not one. Wood, metal, fabric and rubber respond differently
//   to the same light, and a scene where everything shares one roughness reads as
//   a greybox no matter how well it is lit. Geometry is merged PER MATERIAL, so
//   this costs 4 draw calls rather than 1.
//
// Two constraints from the scene itself:
//
// * NO POINT LIGHTS. `NUM_POINT_LIGHTS` is part of three's program cache key, so
//   adding them later recompiles the floor, bath and sphere materials. The panel
//   RectAreaLights below are mounted in the initial tree, so the count is fixed
//   from frame one; warm spill is additive cards.
// * EMISSIVES MUST BE HDR, BUT NOT BY MUCH. @react-three/postprocessing forces
//   NoToneMapping, so Bloom's 0.8 threshold sees raw linear luma — saturated red
//   peaks at 0.2125 and can never bloom, while anything past 1.0 clips to a flat
//   block with no rolloff. These sit just under, and the halos do the glowing.
//
// Desktop only: fov 24 is VERTICAL, so at a phone's aspect the horizontal
// half-angle is 5.6° and the bath alone spans ±4.6°. Every prop here is
// off-screen on mobile; <Scene/> gates the whole component out.

// Idempotent; lighting.tsx also calls it. Required before the first
// RectAreaLight material compiles.
RectAreaLightUniformsLib.init();

const FLOOR_Y = -5;

// World placements (x, z) on the floor. Pulled in tight around the bath at z −6:
// with the nearest prop at −14 there was a dead gap, all the lit floor sat BEHIND
// the tub, and the eye read that band as the ground with the tub floating below
// it. The depth ramp is now continuous — crate −2, bath −6, boots −10, panel −13,
// sauna −14, shelf −17 — and every prop clears the bath's ±4.6° silhouette cone.
const S: [number, number, number] = [-13, FLOOR_Y, -24]; // sauna tent
const B: [number, number, number] = [6.6, FLOOR_Y, -10]; // boots + bench
const P: [number, number, number] = [7.0, FLOOR_Y, -13]; // red-light panel
const H: [number, number, number] = [-9.0, FLOOR_Y, -17]; // shelf
const F: [number, number, number] = [-8, FLOOR_Y, -2]; // foreground
const S_YAW = 0.35;
const B_YAW = 0.26;
const P_YAW = -0.5;
const F_YAW = 0.4;

type Slot = "wood" | "metal" | "fabric" | "rubber" | "plastic";
type Part = { geo: THREE.BufferGeometry; slot: Slot };

// ─── geometry helpers ───────────────────────────────────────────────────────

/** Rounded box. `r` is the bevel; keep it small relative to the smallest axis. */
function rbox(w: number, h: number, d: number, r = 0.04) {
  return new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2));
}
const cyl = (r: number, h: number, seg = 12) =>
  new THREE.CylinderGeometry(r, r, h, seg);

/** Clone a geometry and bake a local transform — mergeGeometries applies none. */
function place(
  geo: THREE.BufferGeometry,
  [x, y, z]: [number, number, number],
  rotY = 0,
) {
  const g = geo.clone();
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
  return g;
}

const at = (parts: Part[], pos: [number, number, number], yaw = 0): Part[] =>
  parts.map((p) => ({ slot: p.slot, geo: place(p.geo, pos, yaw) }));

// ─── props ──────────────────────────────────────────────────────────────────

/** Portable sauna tent — 1m x 1m footprint, 2m tall.
 *
 *  Scale is derived, not eyeballed. The bath GLB is 9.0 x 5.29 x 4.64 world
 *  units and a cold plunge is ~1.7m long, which puts the scene at 5.29 units per
 *  metre. The first version of this prop was 5.0 x 3.4 x 4.0 units — 0.94m wide
 *  but only 0.64m tall, a squat shed. Hence "a whole room": the footprint was
 *  about right and the height was 3x short, so the proportions read as a
 *  building. A real tent is NARROW and TALL, and at 2m it legitimately stands
 *  more than twice the height of the tub.
 *
 *  Construction is a soft shell on a visible frame: heavily bevelled panels so
 *  the plastic reads as stretched skin rather than sheet, corner poles and top
 *  rails in metal, a zip up the front, and the head opening at the top that
 *  makes these things recognisable. */
const TENT_W = 5.3; // 1.0m
const TENT_H = 10.6; // 2.0m

function sauna(): Part[] {
  const halfW = TENT_W / 2;
  const bodyH = TENT_H - 0.7; // sits on a shallow floor pan
  const parts: Part[] = [
    // Floor pan
    { geo: place(rbox(TENT_W, 0.35, TENT_W, 0.08), [0, 0.17, 0]), slot: "metal" },
    // Shell. A big bevel is doing the work here — it rounds every edge the way
    // tensioned fabric does, which is most of what separates "tent" from "box".
    { geo: place(rbox(TENT_W - 0.3, bodyH, TENT_W - 0.3, 0.5), [0, 0.35 + bodyH / 2, 0]), slot: "plastic" },
  ];
  // Corner poles + top rails: the frame the skin is stretched over.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.09, TENT_H - 0.4, 8), [x * (halfW - 0.16), 0.35 + (TENT_H - 0.4) / 2, z * (halfW - 0.16)]),
      slot: "metal",
    });
  }
  const railY = TENT_H - 0.15;
  parts.push(
    { geo: place(rbox(TENT_W - 0.2, 0.1, 0.1, 0.03), [0, railY, halfW - 0.16]), slot: "metal" },
    { geo: place(rbox(TENT_W - 0.2, 0.1, 0.1, 0.03), [0, railY, -(halfW - 0.16)]), slot: "metal" },
    { geo: place(rbox(0.1, 0.1, TENT_W - 0.2, 0.03), [halfW - 0.16, railY, 0]), slot: "metal" },
    { geo: place(rbox(0.1, 0.1, TENT_W - 0.2, 0.03), [-(halfW - 0.16), railY, 0]), slot: "metal" },
  );
  // Zip up the front, and its pull.
  parts.push(
    { geo: place(rbox(0.13, bodyH - 1.2, 0.07, 0.04), [0, 0.35 + bodyH / 2 - 0.2, halfW - 0.16]), slot: "metal" },
    { geo: place(cyl(0.05, 0.3, 6), [0, 1.5, halfW - 0.1]), slot: "metal" },
  );
  // Horizontal quilt seams. Without them the shell is one flat panel and reads
  // as a shower cubicle; segmenting it is what says "stitched fabric".
  for (const sy of [2.4, 4.8, 7.2]) {
    parts.push(
      { geo: place(rbox(TENT_W - 0.34, 0.09, 0.06, 0.03), [0, sy, halfW - 0.17]), slot: "metal" },
      { geo: place(rbox(0.06, 0.09, TENT_W - 0.34, 0.03), [halfW - 0.17, sy, 0]), slot: "metal" },
      { geo: place(rbox(0.06, 0.09, TENT_W - 0.34, 0.03), [-(halfW - 0.17), sy, 0]), slot: "metal" },
    );
  }
  // Head opening at the top — the detail that makes a sauna tent legible.
  parts.push({
    geo: place(rbox(2.2, 0.28, 2.0, 0.13), [0, TENT_H - 0.5, 0]),
    slot: "metal",
  });
  return parts;
}

/** One compression boot: a tapered sleeve with segment seams and a zip. */
function boot(): Part[] {
  // Taller and narrower than the first pass, which at this distance read as a
  // stack of tyres. A leg sleeve is tall relative to its width.
  const profile = [
    [0.36, 0], [0.355, 0.3], [0.335, 0.62], [0.30, 0.95],
    [0.26, 1.28], [0.215, 1.58], [0.19, 1.74], [0, 1.76],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const parts: Part[] = [
    { geo: new THREE.LatheGeometry(profile, 18), slot: "rubber" },
  ];
  // Explicit torus segments: the default (12, 48) is 1,152 triangles for a rib
  // that lands ~8 device px wide — sub-pixel detail SMAA turns into shimmer.
  for (const [y, r] of [[0.44, 0.348], [0.86, 0.315], [1.26, 0.265], [1.6, 0.213]]) {
    const t = new THREE.TorusGeometry(r, 0.022, 6, 18);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    parts.push({ geo: t, slot: "rubber" });
  }
  // Zip strip down the front — the detail that says "garment", not "cylinder".
  parts.push({ geo: place(rbox(0.07, 1.62, 0.06, 0.02), [0, 0.85, 0.3]), slot: "metal" });
  return parts;
}

/** Compression boots on a low bench, plus the pump unit and its hoses. */
function bench(): Part[] {
  const parts: Part[] = [
    { geo: place(rbox(3, 0.14, 1.1, 0.04), [0, 0.62, 0]), slot: "metal" },
  ];
  for (const [x, z] of [[-1.35, 0.45], [1.35, 0.45], [-1.35, -0.45], [1.35, -0.45]]) {
    parts.push({ geo: place(cyl(0.05, 0.62, 8), [x, 0.31, z]), slot: "metal" });
  }
  for (const bx of [-0.5, 0.32]) {
    for (const p of boot()) {
      parts.push({ slot: p.slot, geo: place(p.geo, [bx, 0.69, 0]) });
    }
  }
  // Pump unit
  parts.push({ geo: place(rbox(0.52, 0.34, 0.36, 0.04), [1.18, 0.86, 0]), slot: "metal" });
  // Hoses from the unit up to each boot cuff — a curve reads as equipment in a
  // way that another box never does.
  for (const bx of [-0.5, 0.32]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.05, 0.95, 0.12),
      new THREE.Vector3((1.05 + bx) / 2, 1.5, 0.34),
      new THREE.Vector3(bx, 2.2, 0.24),
    ]);
    parts.push({ geo: new THREE.TubeGeometry(curve, 14, 0.035, 5, false), slot: "rubber" });
  }
  return parts;
}

/** Red-light therapy panel on a weighted stand. */
function panel(): Part[] {
  return [
    { geo: place(cyl(0.5, 0.09, 16), [0, 0.045, 0]), slot: "metal" },
    { geo: place(cyl(0.07, 0.95, 10), [0, 0.52, 0]), slot: "metal" },
    { geo: place(rbox(1.7, 1.7, 0.14, 0.05), [0, 1.85, 0]), slot: "metal" },
    // Yoke brackets either side of the frame.
    { geo: place(rbox(0.08, 0.5, 0.1, 0.03), [-0.86, 1.5, 0]), slot: "metal" },
    { geo: place(rbox(0.08, 0.5, 0.1, 0.03), [0.86, 1.5, 0]), slot: "metal" },
  ];
}

/** Shelf of folded towels. */
function shelf(): Part[] {
  const parts: Part[] = [
    { geo: place(rbox(5, 0.12, 1, 0.03), [0, 1, 0]), slot: "wood" },
    { geo: place(rbox(4.8, 0.09, 0.9, 0.03), [0, 0.45, 0]), slot: "wood" },
    { geo: place(rbox(0.1, 1, 1, 0.03), [-2.45, 0.5, 0]), slot: "metal" },
    { geo: place(rbox(0.1, 1, 1, 0.03), [2.45, 0.5, 0]), slot: "metal" },
  ];
  // Generous bevel: a folded towel has no sharp edge anywhere on it.
  const towels: [number, number, number][] = [
    [-1.5, 1.14, 0.03], [-1.46, 1.29, -0.02], [-1.53, 1.44, 0.01],
    [1.3, 1.14, 0.0], [1.34, 1.29, 0.04],
  ];
  for (const t of towels) {
    parts.push({ geo: place(rbox(0.7, 0.15, 0.5, 0.06), t), slot: "fabric" });
  }
  return parts;
}

/** Foreground: a foam roller and folded towels on a low crate, close to camera.
 *  A near object is the cheapest depth cue there is — it gives the long lens
 *  something to measure the room against and anchors the near end of the ramp.
 *  It sits on a crate rather than flat on the floor for a framing reason: at fov
 *  24 the camera is 11 units above the ground, so anything lying ON the floor
 *  this close lands ~94% of the way to the bottom edge and clips.
 *  "Rodillo" is real VULL kit — it appears in the studio photography on /planes. */
function foreground(): Part[] {
  const roller = cyl(0.3, 1.5, 16);
  roller.rotateZ(Math.PI / 2); // lay it on its side
  return [
    { geo: place(rbox(1.5, 0.55, 0.8, 0.05), [0, 0.275, 0]), slot: "wood" },
    { geo: roller.translate(0, 0.85, 0), slot: "rubber" },
    { geo: place(rbox(0.5, 0.13, 0.36, 0.05), [0.85, 0.62, 0.12]), slot: "fabric" },
    { geo: place(rbox(0.46, 0.11, 0.33, 0.05), [0.83, 0.74, 0.16]), slot: "fabric" },
  ];
}

// ─── lighting + volumetrics ─────────────────────────────────────────────────

// Two soft panel lights, one per cluster. The scene's own rig is aimed tightly at
// the bath — the stage spot's cone dies by z ≈ −17 and the underglow has a hard
// distance cutoff of 18 — so out here the props received ~14% of bath-level
// irradiance and read as pure black on a black floor. These rake ACROSS the props
// rather than lighting the room.
const PANELS = [
  {
    pos: [-15, 9, -13] as const,
    aim: [-13, 0, -24] as const,
    size: [18, 14] as const,
    color: "#c8d6cd",
    intensity: 5.2,
  },
  {
    pos: [10, 4.5, -7] as const,
    aim: [7, -4.5, -13] as const,
    size: [13, 8] as const,
    color: "#bfd0c8",
    intensity: 5.5,
  },
] as const;

function PanelLights() {
  const refs = useRef<(THREE.RectAreaLight | null)[]>([]);
  // A RectAreaLight has no `target`; it must be aimed once, after positioning.
  useEffect(() => {
    PANELS.forEach((p, i) => refs.current[i]?.lookAt(p.aim[0], p.aim[1], p.aim[2]));
  }, []);
  return (
    <>
      {PANELS.map((p, i) => (
        <rectAreaLight
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          position={p.pos}
          width={p.size[0]}
          height={p.size[1]}
          color={p.color}
          intensity={p.intensity}
        />
      ))}
    </>
  );
}

// Contact shadow pressed into the floor under each prop. The bath had one and the
// props did not, so the tub was the only object welded to the ground.
const CONTACT_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.2, d) * uOpacity;
    gl_FragColor = vec4(vec3(0.0), a);
  }
`;

// Soft radial halo — the additive stand-in for a point light.
const GLOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  uniform vec3 uColor;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 2.4) * uOpacity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

const PALETTE = {
  // Warm/red practicals are extra hues in a one-green system. They stay
  // legitimate as MOTIVATED light — the equipment itself glowing — and are held
  // low. Dial these toward zero if they ever fight the brand.
  amber: new THREE.Color("#ffc98f").multiplyScalar(1.1),
  green: new THREE.Color("#6ccb45").multiplyScalar(2.0),
};

const CONTACT_BASE = 0.42;

export function RoomProps() {
  const group = useRef<THREE.Group>(null);

  const built = useMemo(() => {
    const parts: Part[] = [
      ...at(sauna(), S, S_YAW),
      ...at(bench(), B, B_YAW),
      ...at(panel(), P, P_YAW),
      ...at(shelf(), H, 0),
      ...at(foreground(), F, F_YAW),
    ];

    // Four materials, because a scene where everything shares one roughness reads
    // as a greybox however well it is lit.
    const mats: Record<Slot, THREE.MeshStandardMaterial> = {
      wood: new THREE.MeshStandardMaterial({
        color: "#1b1610", roughness: 0.84, metalness: 0.0, transparent: true,
      }),
      metal: new THREE.MeshStandardMaterial({
        color: "#12161a", roughness: 0.36, metalness: 0.8, transparent: true,
      }),
      fabric: new THREE.MeshStandardMaterial({
        color: "#39413c", roughness: 0.96, metalness: 0.0, transparent: true,
      }),
      rubber: new THREE.MeshStandardMaterial({
        color: "#0e1110", roughness: 0.72, metalness: 0.06, transparent: true,
      }),
      // Coated vinyl/plastic shell — lighter than everything else out here so the
      // tent reads as a soft skin stretched on a frame, not another dark box.
      plastic: new THREE.MeshStandardMaterial({
        color: "#242a28", roughness: 0.62, metalness: 0.08, transparent: true,
      }),
    };

    // Merge per material → 4 draw calls for the whole room.
    // RoundedBoxGeometry is NON-indexed while BoxGeometry/Cylinder/Lathe are
    // indexed, and mergeGeometries returns null on a mixed set — normalise first.
    const groups = (["wood", "metal", "fabric", "rubber", "plastic"] as Slot[]).map((slot) => {
      const geos = parts
        .filter((p) => p.slot === slot)
        .map((p) => (p.geo.index ? p.geo.toNonIndexed() : p.geo));
      const merged = geos.length ? mergeGeometries(geos, false) : null;
      if (!merged) throw new Error(`props: merge failed for ${slot}`);
      return { geo: merged, mat: mats[slot] };
    });

    const emissive = (c: THREE.Color) =>
      new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true });

    const emissives = [
      {
        // Sauna door slit — the warm anchor of the whole left side.
        geo: place(place(rbox(0.09, 4.2, 0.04, 0.02), [0, 4.4, 2.47]), S, S_YAW),
        mat: emissive(PALETTE.amber),
      },
      {
        // Pump-unit LED — the one brand-green note out here.
        geo: place(place(rbox(0.08, 0.05, 0.03, 0.01), [1.18, 0.97, 0.19]), B, B_YAW),
        mat: emissive(PALETTE.green),
      },
    ];

    const glows = [
      {
        // Behind the cabin: a dim pool its silhouette can cut against.
        pos: [-13.4, FLOOR_Y + 4.8, -27.5] as [number, number, number],
        size: [19, 18] as [number, number],
        mat: makeMat(GLOW_FRAG, "#8d9d94", 0.2),
      },
      {
        // Warm spill out of the door.
        pos: [-12.2, FLOOR_Y + 4.4, -21.6] as [number, number, number],
        size: [4.0, 7.5] as [number, number],
        mat: makeMat(GLOW_FRAG, "#ffb46b", 0.38),
      },
      {
        // The panel's emitting face — a radial falloff rather than a flat quad,
        // so it has no hard edge to read as a pasted-on rectangle.
        pos: [7.42, FLOOR_Y + 1.85, -12.93] as [number, number, number],
        size: [2.3, 2.3] as [number, number],
        rotY: P_YAW,
        mat: makeMat(GLOW_FRAG, "#ff5330", 0.5),
      },
      {
        pos: [7.2, FLOOR_Y + 1.85, -12.3] as [number, number, number],
        size: [5.5, 5.5] as [number, number],
        rotY: P_YAW,
        mat: makeMat(GLOW_FRAG, "#ff4a3a", 0.16),
      },
      {
        pos: [-9, FLOOR_Y + 0.8, -16.4] as [number, number, number],
        size: [5.4, 1.8] as [number, number],
        mat: makeMat(GLOW_FRAG, "#9fbfa8", 0.2),
      },
    ];

    // Footprints, slightly larger than each base. Kept UNDER the prop rather than
    // around it — a shadow wider than its object erases the ground it implies.
    const contacts = (
      [
        { pos: [S[0], FLOOR_Y + 0.03, S[2]], size: [7.2, 7.2] },
        { pos: [B[0], FLOOR_Y + 0.03, B[2]], size: [4.4, 2.4] },
        { pos: [P[0], FLOOR_Y + 0.03, P[2]], size: [2.2, 1.8] },
        { pos: [H[0], FLOOR_Y + 0.03, H[2]], size: [6.4, 2.4] },
        { pos: [F[0], FLOOR_Y + 0.03, F[2]], size: [2.8, 2.0] },
      ] as { pos: [number, number, number]; size: [number, number] }[]
    ).map((c) => ({
      ...c,
      mat: makeMat(CONTACT_FRAG, "#000000", CONTACT_BASE, 0, THREE.NormalBlending),
    }));

    return { groups, emissives, glows, contacts };
  }, []);

  const { groups, emissives, glows, contacts } = built;
  const baseGlow = useMemo(
    () => glows.map((g) => g.mat.uniforms.uOpacity.value),
    [glows],
  );

  // Fog is camera-relative and the camera travels ~102u toward these props, so
  // they DE-fog over the ride: haziest under the hero copy, crispest exactly when
  // the VULL mark should own the frame. Dissolve them over the assembly window.
  useFrame(() => {
    const p = useProgressStore.getState().progress;
    const k = 1 - Math.min(1, Math.max(0, (p - 0.86) / 0.1));
    for (const g of groups) g.mat.opacity = k;
    for (const e of emissives) e.mat.opacity = k;
    glows.forEach((g, i) => (g.mat.uniforms.uOpacity.value = baseGlow[i] * k));
    for (const c of contacts) c.mat.uniforms.uOpacity.value = CONTACT_BASE * k;
    if (group.current) group.current.visible = k > 0.001;
  });

  return (
    <group ref={group}>
      <PanelLights />
      {contacts.map((c, i) => (
        <mesh
          key={`c${i}`}
          rotation={[-Math.PI / 2, 0, 0]}
          position={c.pos}
          material={c.mat}
          renderOrder={2}
        >
          <planeGeometry args={c.size} />
        </mesh>
      ))}
      {groups.map((g, i) => (
        <mesh key={`g${i}`} geometry={g.geo} material={g.mat} />
      ))}
      {emissives.map((e, i) => (
        <mesh key={`e${i}`} geometry={e.geo} material={e.mat} />
      ))}
      {glows.map((g, i) => (
        <mesh
          key={`w${i}`}
          position={g.pos}
          rotation={[0, g.rotY ?? 0, 0]}
          material={g.mat}
          renderOrder={1}
        >
          <planeGeometry args={g.size} />
        </mesh>
      ))}
    </group>
  );
}
