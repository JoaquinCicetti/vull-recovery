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
// * SEVERAL materials, not one. Wood, metal, fabric and rubber respond differently
//   to the same light, and a scene where everything shares one roughness reads as
//   a greybox no matter how well it is lit. Geometry is merged PER MATERIAL, so
//   this costs one draw call per material rather than 1 total.
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
// On a phone the lens opens up (see <Scene/>): fov 24 is VERTICAL, so at a
// portrait aspect its horizontal half-angle is 5.6° and every prop here would
// be off-screen. The wider mobile fov is what brings the room into frame.

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
const F: [number, number, number] = [-10.5, FLOOR_Y, -1]; // foreground towel rack
const S_YAW = 0.35;
const B_YAW = 0.26;
const P_YAW = -0.5;
const F_YAW = 0.4;

type Slot = "wood" | "metal" | "fabric" | "rubber" | "canvas" | "tape" | "nylon" | "vinyl" | "led";
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
  scale = 1,
) {
  const g = geo.clone();
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(scale, scale, scale),
    ),
  );
  return g;
}

const at = (parts: Part[], pos: [number, number, number], yaw = 0): Part[] =>
  parts.map((p) => ({ slot: p.slot, geo: place(p.geo, pos, yaw) }));

// ─── props ──────────────────────────────────────────────────────────────────

/** Portable sauna tent — the grow-tent kind: 1.2m square, 2m tall, black canvas.
 *
 *  Scale is derived, not eyeballed. The bath GLB is 9.0 x 5.29 x 4.64 world
 *  units and a cold plunge is ~1.7m long, which puts the scene at 5.29 units per
 *  metre.
 *
 *  What made the previous pass read as a FRIDGE: a tall narrow box in a
 *  light-grey shell. A grow tent is the opposite on both counts — a squarer
 *  1.2 x 1.2 footprint, and matte BLACK canvas that swallows light. On a black
 *  canvas the only things that draw the object are the seams: lighter zip tape
 *  outlining the big front door, the webbing at the corners where the poles push
 *  the fabric out, the round duct ports, and the warm slit of the door. Those
 *  are what is modelled; the box itself is meant to nearly vanish. */
const TENT_W = 6.4; // 1.2m
const TENT_H = 10.6; // 2.0m

function sauna(): Part[] {
  const halfW = TENT_W / 2;
  const parts: Part[] = [
    // The canvas: one box, tiny bevel — fabric pulled taut over a square frame.
    { geo: place(rbox(TENT_W, TENT_H, TENT_W, 0.08), [0, TENT_H / 2, 0]), slot: "canvas" },
  ];
  // Corner seams: the poles are INSIDE a grow tent; what shows is the fabric
  // ridging over them. A slightly lighter webbing strip on each vertical edge.
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(rbox(0.14, TENT_H - 0.3, 0.14, 0.04), [x * (halfW - 0.02), TENT_H / 2, z * (halfW - 0.02)]),
      slot: "tape",
    });
  }
  // Top and bottom hems, same webbing, running along the front and the visible side.
  for (const ry of [TENT_H - 0.08, 0.08]) {
    parts.push(
      { geo: place(rbox(TENT_W + 0.04, 0.12, 0.12, 0.03), [0, ry, halfW]), slot: "tape" },
      { geo: place(rbox(0.12, 0.12, TENT_W + 0.04, 0.03), [-halfW, ry, 0]), slot: "tape" },
    );
  }
  // The door: a big rectangular zip flap across the front — two vertical zips
  // and a top run, joined at the bottom, exactly like the real thing. The tape
  // is the lightest material on the tent so the outline reads from 30 metres.
  const dW = TENT_W - 1.6, dTop = TENT_H - 1.0, dBot = 0.6, fz = halfW + 0.03;
  const dH = dTop - dBot, dCy = (dTop + dBot) / 2;
  parts.push(
    { geo: place(rbox(0.16, dH, 0.06, 0.02), [-dW / 2, dCy, fz]), slot: "tape" },
    { geo: place(rbox(0.16, dH, 0.06, 0.02), [dW / 2, dCy, fz]), slot: "tape" },
    { geo: place(rbox(dW, 0.16, 0.06, 0.02), [0, dTop, fz]), slot: "tape" },
    // Zip pulls parked at the bottom of each vertical zip.
    { geo: place(rbox(0.1, 0.32, 0.08, 0.02), [-dW / 2, dBot + 0.5, fz + 0.04]), slot: "metal" },
    { geo: place(rbox(0.1, 0.32, 0.08, 0.02), [dW / 2, dBot + 0.5, fz + 0.04]), slot: "metal" },
  );
  // Two roll-up straps across the door, and the horizontal seam of the window flap.
  for (const sy of [dBot + dH * 0.3, dBot + dH * 0.62]) {
    parts.push({ geo: place(rbox(dW - 0.4, 0.12, 0.05, 0.03), [0, sy, fz + 0.01]), slot: "tape" });
  }
  // Round ducting ports on the visible side wall: a drawstring sleeve each, one
  // high (exhaust) and one low (intake). The single most "grow tent" detail.
  for (const [py, pr] of [[TENT_H - 1.6, 0.7], [1.7, 0.55]]) {
    const ring = new THREE.TorusGeometry(pr, 0.11, 8, 22);
    ring.rotateY(Math.PI / 2);
    parts.push({ geo: place(ring, [-(halfW + 0.02), py, 0.4]), slot: "tape" });
    // The sleeve itself, a short stub of canvas poking out.
    const stub = cyl(pr - 0.05, 0.5, 18);
    stub.rotateZ(Math.PI / 2);
    parts.push({ geo: place(stub, [-(halfW + 0.2), py, 0.4]), slot: "canvas" });
  }
  // Small cable port, low on the front corner.
  const cable = new THREE.TorusGeometry(0.22, 0.06, 6, 14);
  parts.push({ geo: place(cable, [halfW - 0.8, 1.2, fz]), slot: "tape" });
  return parts;
}

/** One pneumatic compression boot — a full-leg inflatable sleeve, ~0.95m.
 *
 *  Built to the modelling brief, in this priority order: (1) the long-leg
 *  silhouette, (2) segmented inflatable chambers, (3) black padded nylon,
 *  (4) the long zipper, (5) an enclosed rounded foot, (6) the side control
 *  module, (7) its blue LEDs, (8) fabric irregularity.
 *
 *  Scale at 5.29 units/m: leg 0.95m → 5.0, thigh Ø ~32cm → r 0.85, ankle
 *  Ø ~17cm → r 0.46, foot 27cm → 1.45.
 *
 *  Silhouette is an ENVELOPE — thigh wide, a soft dip at the knee, the calf
 *  swelling again, then narrowing to the ankle — and the chambers ride on it as
 *  rounded bands with recessed seams: large at the thigh, medium at the calf,
 *  small and tight at the ankle. The bulge is held to ~5% so the bands read as
 *  padding, not as a stack of tyres; a light per-chamber irregularity and a
 *  post-pass that ovals the cross-section and ripples the surface keep it from
 *  looking machined.
 *
 *  `side` mirrors the asymmetric details (zipper, module) so the pair is
 *  left/right rather than two copies. */
const LEG_Y0 = 0.82; // where the leg sleeve leaves the foot
const LEG_LEN = 5.0;
const LEG_OVAL = 1.08; // front–back depth over side–side width

/** Leg radius along t ∈ [0 ankle … 1 thigh top]. */
function envelope(t: number): number {
  const ctrl: [number, number][] = [
    [0, 0.46], [0.1, 0.55], [0.3, 0.71], [0.48, 0.66], [0.68, 0.78], [0.86, 0.87], [1, 0.83],
  ];
  for (let i = 1; i < ctrl.length; i++) {
    if (t <= ctrl[i][0]) {
      const [t0, r0] = ctrl[i - 1], [t1, r1] = ctrl[i];
      const u = (t - t0) / (t1 - t0);
      const k = u * u * (3 - 2 * u);
      return r0 + (r1 - r0) * k;
    }
  }
  return ctrl[ctrl.length - 1][1];
}

// Chamber heights as fractions of the leg: 2 ankle, 4 calf, 1 knee, 4 thigh; the
// last 7% is the open cuff.
const CHAMBERS = [0.055, 0.07, 0.08, 0.08, 0.08, 0.08, 0.08, 0.1, 0.1, 0.1, 0.1];

/** Ovalise the cross-section and ripple the surface a little — the difference
 *  between a lathe and a garment. Recomputes normals for smooth shading. */
function fabricate(geo: THREE.BufferGeometry, noise = 0.012): THREE.BufferGeometry {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const th = Math.atan2(x, z);
    const n = 1 + noise * Math.sin(3 * th + y * 1.7) + noise * 0.6 * Math.sin(7 * th - y * 3.1);
    pos.setXYZ(i, x * n, y, z * LEG_OVAL * n);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A point ON the sleeve surface at (t, θ) pushed out by `off`. θ = 0 is the
 *  front (+z); positive θ turns toward +x. */
function onLeg(t: number, th: number, off = 0): THREE.Vector3 {
  const r = envelope(t) + off;
  return new THREE.Vector3(r * Math.sin(th), LEG_Y0 + t * LEG_LEN, r * Math.cos(th) * LEG_OVAL);
}

function boot(side: 1 | -1): Part[] {
  // ── OuterFabricShell + chambers: one lathe, radius = envelope × band ──────
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.001, LEG_Y0)];
  let t = 0;
  CHAMBERS.forEach((h, i) => {
    const irregular = 0.85 + 0.3 * ((i * 0.618) % 1);
    const SAMPLES = 7;
    for (let k = i === 0 ? 0 : 1; k <= SAMPLES; k++) {
      const u = k / SAMPLES;
      const tt = t + u * h;
      // Recessed seam at u = 0 and 1, a soft belly between. Ankle chambers
      // (small h) pinch harder — tighter, more wrinkled.
      const depth = (h < 0.075 ? 0.07 : 0.05) * irregular;
      const band = 1 - depth + depth * Math.pow(Math.sin(Math.PI * u), 0.6);
      pts.push(new THREE.Vector2(envelope(tt) * band, LEG_Y0 + tt * LEG_LEN));
    }
    t += h;
  });
  // The open cuff: a wide mouth with a rolled lip.
  pts.push(new THREE.Vector2(envelope(1) * 0.98, LEG_Y0 + LEG_LEN));
  pts.push(new THREE.Vector2(envelope(1) * 0.9, LEG_Y0 + LEG_LEN + 0.12));
  pts.push(new THREE.Vector2(envelope(1) * 0.72, LEG_Y0 + LEG_LEN + 0.16));
  pts.push(new THREE.Vector2(0.001, LEG_Y0 + LEG_LEN + 0.16));
  const leg = fabricate(new THREE.LatheGeometry(pts, 36));

  // ── Foot: one continuous padded volume — ankle → heel → forefoot → toe cap ─
  const parts: Part[] = [
    { geo: leg, slot: "nylon" },
    // Ankle collar, blending the sleeve into the foot.
    { geo: place(rbox(1.0, 0.9, 1.05, 0.38), [0, 0.7, 0.05]), slot: "nylon" },
    // Heel + midfoot, slightly flattened underneath (a rounded box has a flat base).
    { geo: place(rbox(1.05, 0.8, 1.5, 0.36), [0, 0.42, 0.45]), slot: "nylon" },
  ];
  // Forefoot widens a touch; the toe is a soft rounded cap, no toes.
  const toe = new THREE.SphereGeometry(0.5, 18, 12);
  toe.scale(1.12, 0.78, 1.0);
  toe.translate(0, 0.42, 1.15);
  parts.push({ geo: toe, slot: "nylon" });
  // Foot chambers: two small padded bands over the instep, same recessed-seam idea.
  for (const [z, r] of [[0.35, 0.5], [0.8, 0.46]]) {
    const band = new THREE.TorusGeometry(r, 0.11, 8, 20);
    band.rotateX(Math.PI / 2);
    band.rotateZ(0.0);
    parts.push({ geo: place(band, [0, 0.62, z]), slot: "nylon" });
  }

  // ── Zipper: tape + teeth + slider, following the sleeve's curve ───────────
  // Runs down the front–outer quarter of the leg so the camera sees it. Grey
  // webbing rather than the orange of the reference: at this distance a bright
  // orange line read as a red cable, not a zip.
  const zTh = side * 0.8;
  const zip = new THREE.CatmullRomCurve3(
    Array.from({ length: 14 }, (_, i) => onLeg(0.06 + (0.9 * i) / 13, zTh, 0.02)),
  );
  parts.push(
    { geo: new THREE.TubeGeometry(zip, 40, 0.075, 6, false), slot: "tape" },
    // Teeth: a thinner, darker rail riding on the tape.
    {
      geo: new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(
          Array.from({ length: 14 }, (_, i) => onLeg(0.06 + (0.9 * i) / 13, zTh, 0.07)),
        ),
        40, 0.032, 5, false,
      ),
      slot: "metal",
    },
  );
  // Slider near the top of the run, oriented to the surface.
  const sl = onLeg(0.9, zTh, 0.1);
  parts.push({ geo: place(rbox(0.16, 0.3, 0.12, 0.03), [sl.x, sl.y, sl.z], zTh), slot: "metal" });

  // ── ControlModule: housing on the outer thigh, LEDs and buttons on its face ─
  const mTh = side * 1.35;
  const m = onLeg(0.74, mTh, 0.06);
  parts.push({ geo: place(rbox(0.55, 0.82, 0.2, 0.06), [m.x, m.y, m.z], mTh), slot: "rubber" });
  const face = onLeg(0.74, mTh, 0.17);
  for (const dy of [0.24, 0.12, 0.0, -0.12]) {
    parts.push({ geo: place(rbox(0.07, 0.05, 0.03, 0.01), [face.x, face.y + dy, face.z], mTh), slot: "led" });
  }
  for (const [dx, dy] of [[-0.14, -0.28], [0.14, -0.28]]) {
    const b = onLeg(0.74, mTh + side * dx * 0.3, 0.17);
    parts.push({ geo: place(rbox(0.09, 0.09, 0.03, 0.02), [b.x, b.y + dy, b.z], mTh), slot: "metal" });
  }

  return parts;
}

/** A reclining lounger — the thing people actually sit in while the boots
 *  inflate. Side-on to the camera, because the recline profile (raised leg
 *  rest, deep seat, backrest tilted up) is the silhouette that reads as
 *  "recovery chair" rather than "bench". Foot end toward the boots. */
function lounger(): Part[] {
  const L = 8.6, W = 3.8, seatY = 2.0;
  const parts: Part[] = [];
  // Frame: two side rails, four legs, a crossbar.
  for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) {
    parts.push({ geo: place(rbox(L, 0.14, 0.14, 0.04), [0, seatY - 0.15, z]), slot: "metal" });
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.09, seatY - 0.15, 8), [x * (L / 2 - 0.4), (seatY - 0.15) / 2, z * (W / 2 - 0.1)]),
      slot: "metal",
    });
  }
  parts.push({ geo: place(rbox(0.12, 0.12, W - 0.2, 0.03), [0, seatY - 0.15, 0]), slot: "metal" });
  // Seat cushion — deep and soft.
  parts.push({ geo: place(rbox(3.6, 0.6, W - 0.3, 0.22), [-0.4, seatY + 0.2, 0]), slot: "vinyl" });
  // Leg rest: raised toward the foot end.
  const legRest = rbox(3.2, 0.5, W - 0.4, 0.2);
  legRest.rotateZ(-0.22);
  parts.push({ geo: place(legRest, [-3.3, seatY + 0.6, 0]), slot: "vinyl" });
  // Backrest: tilted up ~60°, with a headrest pillow on top.
  const back = rbox(3.8, 0.55, W - 0.3, 0.22);
  back.rotateZ(1.05);
  parts.push({ geo: place(back, [2.6, seatY + 1.9, 0]), slot: "vinyl" });
  parts.push({ geo: place(rbox(0.5, 1.6, 2.2, 0.2), [3.9, seatY + 3.1, 0], 0), slot: "vinyl" });
  // Armrests.
  for (const z of [-W / 2 + 0.05, W / 2 - 0.05]) {
    parts.push({ geo: place(rbox(2.6, 0.24, 0.5, 0.1), [0.9, seatY + 1.3, z]), slot: "vinyl" });
    parts.push({ geo: place(cyl(0.07, 1.0, 8), [0.9, seatY + 0.8, z]), slot: "metal" });
  }
  return parts;
}

/** The pair standing on the floor, the recliner to their right, the pump on a
 *  side table to their left. */
const BOOT_SCALE = 0.85;

function bench(): Part[] {
  const parts: Part[] = [];
  // Left and right boots, feet toward camera, slightly splayed like a pair
  // just stepped out of — standing right at the recliner's foot end.
  for (const [bx, yaw, side] of [[-1.0, 0.14, -1], [1.0, -0.1, 1]] as const) {
    for (const p of boot(side)) {
      parts.push({ slot: p.slot, geo: place(p.geo, [bx, 0, 0], yaw, BOOT_SCALE) });
    }
  }
  // Side table: 0.6m x 0.45m tall, on the boots' left.
  const tw = 3.2, th = 2.4, td = 2.1, tx = -3.6;
  parts.push({ geo: place(rbox(tw, 0.16, td, 0.05), [tx, th, 0]), slot: "metal" });
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    parts.push({
      geo: place(cyl(0.07, th, 8), [tx + x * (tw / 2 - 0.2), th / 2, z * (td / 2 - 0.2)]),
      slot: "metal",
    });
  }
  // Pump unit on the table.
  parts.push({ geo: place(rbox(1.3, 0.85, 0.9, 0.08), [tx, th + 0.5, 0]), slot: "metal" });
  // Hoses from the pump to each cuff.
  for (const bx of [-1.0, 1.0]) {
    const top = (LEG_Y0 + LEG_LEN) * BOOT_SCALE;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(tx + 0.55, th + 0.6, 0.3),
      new THREE.Vector3((tx + 0.55 + bx) / 2, top + 0.9, 0.7),
      new THREE.Vector3(bx + 0.28, top + 0.35, 0.05),
    ]);
    parts.push({ geo: new THREE.TubeGeometry(curve, 16, 0.05, 5, false), slot: "rubber" });
  }
  // The recliner, angled so its raised foot end lands just behind the boots.
  for (const p of lounger()) {
    parts.push({ slot: p.slot, geo: place(p.geo, [4.0, 0, -2.4], -0.45) });
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
 *  Folded and rolled towels are the one soft thing in an otherwise hard room,
 *  so they earn a place up front — and a near object is the cheapest depth cue
 *  there is, giving the long lens something to measure the room against. They
 *  keep the muted grey-green `fabric` material: white towels were tried and
 *  pulled the eye off the bath.
 *
 *  It stands rather than lying flat for a framing reason: at fov 24 the camera is
 *  13 units above the ground, so anything low and this close falls to the bottom
 *  edge and clips. "Rodillo" is real VULL kit — it is in the studio photography
 *  on /planes. */
function foreground(): Part[] {
  const W = 5.2, H = 4.4, D = 2.2;
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
  // Folded stack on the left of the top shelf — generous bevels, because a
  // folded towel has no sharp edge anywhere on it. Each one a touch offset so
  // the pile reads as hand-stacked.
  const stack: [number, number, number][] = [
    [-1.45, H + 0.26, 0.02], [-1.4, H + 0.6, -0.05], [-1.5, H + 0.94, 0.04], [-1.42, H + 1.28, -0.02],
  ];
  for (const t of stack) {
    parts.push({ geo: place(rbox(1.9, 0.36, 1.5, 0.15), t), slot: "fabric" });
  }
  // Rolled towels on the right of the top shelf, lying on their sides.
  for (const [rx, ry, rz] of [[0.95, H + 0.55, -0.3], [0.95, H + 0.55, 0.6], [1.35, H + 1.3, 0.15]]) {
    const roll = cyl(0.46, 1.6, 18);
    roll.rotateZ(Math.PI / 2);
    parts.push({ geo: place(roll, [rx, ry, rz], 0.5), slot: "fabric" });
  }
  // Foam roller on the lower tier, with one more folded towel beside it.
  const roller = cyl(0.42, 2.4, 16);
  roller.rotateZ(Math.PI / 2);
  parts.push({ geo: place(roller, [-0.8, H * 0.52 + 0.5, 0]), slot: "rubber" });
  parts.push({ geo: place(rbox(1.7, 0.34, 1.4, 0.14), [1.4, H * 0.52 + 0.25, 0]), slot: "fabric" });
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
  // Boot control-module LEDs.
  blue: new THREE.Color("#4aa8ff").multiplyScalar(1.6),
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
      // Grow-tent canvas: matte, near-black, swallows the panel light. The tent
      // is drawn by its seams, not by its shell.
      canvas: new THREE.MeshStandardMaterial({
        color: "#0a0c0b", roughness: 0.94, metalness: 0.0, transparent: true,
      }),
      // Zip tape / webbing — the lightest thing on the tent and the boots, so
      // the outlines read against black canvas.
      tape: new THREE.MeshStandardMaterial({
        color: "#5e6461", roughness: 0.62, metalness: 0.1, transparent: true,
      }),
      // Compression-boot nylon: matte black synthetic with a subtle sheen —
      // enough that every padded chamber catches a soft highlight, never plastic.
      nylon: new THREE.MeshStandardMaterial({
        color: "#111413", roughness: 0.6, metalness: 0.05, transparent: true,
      }),
      // Recliner upholstery: dark vinyl, a step glossier than the boot nylon so
      // the two blacks separate.
      vinyl: new THREE.MeshStandardMaterial({
        color: "#1c201f", roughness: 0.5, metalness: 0.04, transparent: true,
      }),
      // Placeholder; the "led" slot is swapped for an emissive below.
      led: new THREE.MeshStandardMaterial({ transparent: true }),
    };

    // Merge per material → one draw call per material for the whole room.
    // RoundedBoxGeometry is NON-indexed while BoxGeometry/Cylinder/Lathe are
    // indexed, and mergeGeometries returns null on a mixed set — normalise first.
    // A slot with no parts is skipped, not an error — otherwise retiring the
    // last use of a material silently takes the whole room down via the
    // boundary (which is exactly what happened when the towels stopped being
    // "fabric").
    const emissive = (c: THREE.Color) =>
      new THREE.MeshBasicMaterial({ color: c, toneMapped: false, transparent: true });

    const groups = (["wood", "metal", "fabric", "rubber", "canvas", "tape", "nylon", "vinyl", "led"] as Slot[])
      .flatMap((slot) => {
        const geos = parts
          .filter((p) => p.slot === slot)
          .map((p) => (p.geo.index ? p.geo.toNonIndexed() : p.geo));
        if (!geos.length) return [];
        const merged = mergeGeometries(geos, false);
        if (!merged) throw new Error(`props: merge failed for ${slot}`);
        // The boot LEDs are the one lit thing in a slot: swap in an emissive.
        const mat: THREE.Material = slot === "led" ? emissive(PALETTE.blue) : mats[slot];
        return [{ geo: merged, mat }];
      });


    const emissives = [
      {
        // Sauna door slit — the warm anchor of the whole left side.
        geo: place(place(rbox(0.1, 5.6, 0.04, 0.02), [0, 4.6, TENT_W / 2 + 0.06]), S, S_YAW),
        mat: emissive(PALETTE.amber),
      },
      {
        // Pump-unit LED — the one brand-green note out here.
        geo: place(place(rbox(0.12, 0.08, 0.04, 0.02), [-3.6, 3.05, 0.47]), B, B_YAW),
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
        pos: [-12.0, FLOOR_Y + 4.6, -20.4] as [number, number, number],
        size: [4.6, 8.5] as [number, number],
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
        { pos: [S[0], FLOOR_Y + 0.03, S[2]], size: [8.4, 8.4] },
        { pos: [B[0] + 1.6, FLOOR_Y + 0.03, B[2] - 0.6], size: [15.0, 6.5] },
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
