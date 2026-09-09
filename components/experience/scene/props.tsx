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

// World placements (x, z) on the floor. The depth ramp is continuous — towel rack
// −1, bath −6, boots −11, panel −16, tent −24 — so the eye never falls into a gap,
// and every prop clears the bath's ~±5° silhouette cone from the hero camera.
const S: [number, number, number] = [-13, FLOOR_Y, -24]; // sauna tent
const B: [number, number, number] = [8, FLOOR_Y, -11]; // boots + pump table
const P: [number, number, number] = [15, FLOOR_Y, -19]; // red-light panel
const F: [number, number, number] = [-7.5, FLOOR_Y, -1]; // foreground towel rack
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
  const bodyH = TENT_H - 0.7;
  const cy = 0.35 + bodyH / 2;
  // Bevel is DELIBERATELY tiny. A grow tent is fabric pulled taut over a square
  // frame: flat panels, hard corners. The previous 0.5 bevel rounded it into a
  // soft pod, which is what made it read as a shower cubicle rather than a tent.
  const parts: Part[] = [
    { geo: place(rbox(TENT_W, 0.3, TENT_W, 0.05), [0, 0.15, 0]), slot: "metal" },
    { geo: place(rbox(TENT_W - 0.24, bodyH, TENT_W - 0.24, 0.09), [0, cy, 0]), slot: "plastic" },
  ];
  // Exposed corner poles + top and bottom rails — the frame is part of the look.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.1, TENT_H - 0.4, 8), [x * (halfW - 0.1), 0.35 + (TENT_H - 0.4) / 2, z * (halfW - 0.1)]),
      slot: "metal",
    });
  }
  for (const ry of [TENT_H - 0.2, 0.5]) {
    parts.push(
      { geo: place(rbox(TENT_W - 0.1, 0.11, 0.11, 0.03), [0, ry, halfW - 0.1]), slot: "metal" },
      { geo: place(rbox(TENT_W - 0.1, 0.11, 0.11, 0.03), [0, ry, -(halfW - 0.1)]), slot: "metal" },
      { geo: place(rbox(0.11, 0.11, TENT_W - 0.1, 0.03), [halfW - 0.1, ry, 0]), slot: "metal" },
      { geo: place(rbox(0.11, 0.11, TENT_W - 0.1, 0.03), [-(halfW - 0.1), ry, 0]), slot: "metal" },
    );
  }
  // The door: a big rectangular zip outline across the front face, which is the
  // single most recognisable thing about a grow tent.
  const dW = TENT_W - 1.2, dTop = TENT_H - 1.3, dBot = 0.9, fz = halfW - 0.13;
  const dH = dTop - dBot, dCy = (dTop + dBot) / 2;
  parts.push(
    { geo: place(rbox(0.12, dH, 0.07, 0.03), [-dW / 2, dCy, fz]), slot: "metal" },
    { geo: place(rbox(0.12, dH, 0.07, 0.03), [dW / 2, dCy, fz]), slot: "metal" },
    { geo: place(rbox(dW, 0.12, 0.07, 0.03), [0, dTop, fz]), slot: "metal" },
    { geo: place(rbox(dW, 0.12, 0.07, 0.03), [0, dBot, fz]), slot: "metal" },
    // Zip pull parked at the bottom corner of the perimeter zip.
    { geo: place(cyl(0.05, 0.3, 6), [dW / 2 - 0.15, dBot + 0.42, fz + 0.06]), slot: "metal" },
  );
  // Roll-up straps across the door.
  for (const sy of [dBot + dH * 0.34, dBot + dH * 0.68]) {
    parts.push({ geo: place(rbox(dW - 0.5, 0.1, 0.05, 0.03), [0, sy, fz + 0.02]), slot: "fabric" });
  }
  // Ducting ports, high and low on the side wall.
  for (const [py, pr] of [[TENT_H - 1.9, 0.62], [1.9, 0.5]]) {
    const ring = new THREE.TorusGeometry(pr, 0.085, 6, 20);
    ring.rotateY(Math.PI / 2);
    parts.push({ geo: place(ring, [-(halfW - 0.12), py, 0]), slot: "metal" });
  }
  return parts;
}

/** One compression boot — a full leg sleeve, ~0.85m tall.
 *
 *  The previous version was a plain 0.33m tube with ribs, and the reason it read
 *  as a stack of tyres rather than a boot is that it had NO FOOT. A boot is an
 *  L: a vertical leg and a horizontal foot at the bottom. That silhouette is the
 *  whole recognition cue — the chambers and zip are just detail on top of it. */
function boot(): Part[] {
  // Tapered leg: narrow at the ankle, widest at the thigh.
  const profile = [
    [0.30, 0.55], [0.33, 0.95], [0.365, 1.45], [0.40, 1.95],
    [0.445, 2.5], [0.49, 3.05], [0.53, 3.6], [0.555, 4.05], [0.5, 4.2], [0, 4.22],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const parts: Part[] = [
    { geo: new THREE.LatheGeometry(profile, 18), slot: "rubber" },
    // The foot, projecting forward. Rounded because it is padded fabric.
    { geo: place(rbox(0.66, 0.6, 1.5, 0.22), [0, 0.32, 0.42]), slot: "rubber" },
    // Ankle joint, blending leg into foot.
    { geo: place(rbox(0.62, 0.5, 0.62, 0.2), [0, 0.5, 0.02]), slot: "rubber" },
  ];
  // Five chambers — the real ones inflate in sequence up the leg.
  for (const [y, r] of [
    [1.0, 0.345], [1.75, 0.385], [2.5, 0.448], [3.2, 0.5], [3.9, 0.545],
  ]) {
    const t = new THREE.TorusGeometry(r, 0.028, 6, 18);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    parts.push({ geo: t, slot: "rubber" });
  }
  parts.push(
    // Zip up the outside of the leg.
    { geo: place(rbox(0.07, 3.5, 0.06, 0.02), [0.34, 2.4, 0.28]), slot: "metal" },
    // Hose port at the cuff.
    { geo: place(cyl(0.09, 0.4, 8), [0.3, 4.3, 0]), slot: "metal" },
  );
  return parts;
}

/** The boots standing on the floor beside a side table carrying the pump. */
function bench(): Part[] {
  const parts: Part[] = [];
  // Two boots, side by side, feet toward camera.
  for (const [bx, yaw] of [[-0.75, 0.12], [0.75, -0.1]]) {
    for (const p of boot()) {
      parts.push({ slot: p.slot, geo: place(p.geo, [bx, 0, 0], yaw) });
    }
  }
  // Side table: 0.6m x 0.45m tall.
  const tw = 3.2, th = 2.4, td = 2.1;
  parts.push({ geo: place(rbox(tw, 0.16, td, 0.05), [2.9, th, 0]), slot: "metal" });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.07, th, 8), [2.9 + x * (tw / 2 - 0.2), th / 2, z * (td / 2 - 0.2)]),
      slot: "metal",
    });
  }
  // Pump unit on the table.
  parts.push({ geo: place(rbox(1.3, 0.85, 0.9, 0.08), [2.9, th + 0.5, 0]), slot: "metal" });
  // Hoses from the pump to each cuff.
  for (const bx of [-0.75, 0.75]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(2.35, th + 0.6, 0.3),
      new THREE.Vector3((2.35 + bx) / 2, 4.3, 0.7),
      new THREE.Vector3(bx + 0.3, 4.35, 0.1),
    ]);
    parts.push({ geo: new THREE.TubeGeometry(curve, 16, 0.055, 5, false), slot: "rubber" });
  }
  return parts;
}

/** Red-light therapy panel on a weighted stand, ~1.2m tall. */
function panel(): Part[] {
  return [
    { geo: place(cyl(0.7, 0.14, 16), [0, 0.07, 0]), slot: "metal" },
    { geo: place(cyl(0.09, 1.7, 10), [0, 0.85, 0]), slot: "metal" },
    { geo: place(rbox(2.6, 4.4, 0.2, 0.06), [0, 3.9, 0]), slot: "metal" },
    { geo: place(rbox(0.1, 0.7, 0.12, 0.03), [-1.3, 2.6, 0]), slot: "metal" },
    { geo: place(rbox(0.1, 0.7, 0.12, 0.03), [1.3, 2.6, 0]), slot: "metal" },
  ];
}

/** Towel rack in the FOREGROUND, with the foam roller on the lower tier.
 *
 *  This started as a shelf 17 units back where the towels were an unreadable
 *  smudge. Folded towels are the one soft, light-toned thing in an otherwise
 *  hard, dark room, so they earn a place up front — and a near object is the
 *  cheapest depth cue there is, giving the long lens something to measure the
 *  room against.
 *
 *  It stands rather than lying flat for a framing reason: at fov 24 the camera is
 *  13 units above the ground, so anything low and this close falls to the bottom
 *  edge and clips. "Rodillo" is real VULL kit — it is in the studio photography
 *  on /planes. */
function foreground(): Part[] {
  const W = 4.8, H = 4.2, D = 2.1;
  const parts: Part[] = [
    { geo: place(rbox(W, 0.16, D, 0.04), [0, H, 0]), slot: "wood" },
    { geo: place(rbox(W - 0.3, 0.14, D - 0.2, 0.04), [0, H * 0.52, 0]), slot: "wood" },
  ];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.1, H, 8), [x * (W / 2 - 0.18), H / 2, z * (D / 2 - 0.18)]),
      slot: "metal",
    });
  }
  // Folded towels on the top shelf — generous bevels, because a folded towel has
  // no sharp edge anywhere on it.
  const stack: [number, number, number][] = [
    [-1.25, 4.32, 0], [-1.2, 4.62, 0.05], [-1.28, 4.9, -0.04],
    [0.75, 4.32, 0.02], [0.8, 4.6, -0.03],
  ];
  for (const t of stack) {
    parts.push({ geo: place(rbox(1.7, 0.32, 1.35, 0.14), t), slot: "fabric" });
  }
  // Foam roller on the lower tier.
  const roller = cyl(0.42, 2.4, 16);
  roller.rotateZ(Math.PI / 2);
  parts.push({ geo: place(roller, [0, H * 0.52 + 0.5, 0]), slot: "rubber" });
  return parts;
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
    pos: [12, 6, -5] as const,
    aim: [11, -3, -16] as const,
    size: [14, 11] as const,
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
        color: "#1e2422", roughness: 0.64, metalness: 0.08, transparent: true,
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
        geo: place(place(rbox(0.12, 0.08, 0.04, 0.02), [2.9, 3.05, 0.47]), B, B_YAW),
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
        pos: [15.5, FLOOR_Y + 3.9, -18.87] as [number, number, number],
        size: [3.4, 5.0] as [number, number],
        rotY: P_YAW,
        mat: makeMat(GLOW_FRAG, "#ff5330", 0.5),
      },
      {
        pos: [15.2, FLOOR_Y + 3.9, -18.2] as [number, number, number],
        size: [8.5, 8.5] as [number, number],
        rotY: P_YAW,
        mat: makeMat(GLOW_FRAG, "#ff4a3a", 0.16),
      },
    ];

    // Footprints, slightly larger than each base. Kept UNDER the prop rather than
    // around it — a shadow wider than its object erases the ground it implies.
    const contacts = (
      [
        { pos: [S[0], FLOOR_Y + 0.03, S[2]], size: [7.2, 7.2] },
        { pos: [B[0], FLOOR_Y + 0.03, B[2]], size: [6.5, 3.6] },
        { pos: [P[0], FLOOR_Y + 0.03, P[2]], size: [3.0, 2.4] },
        { pos: [F[0], FLOOR_Y + 0.03, F[2]], size: [6.0, 3.2] },
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
