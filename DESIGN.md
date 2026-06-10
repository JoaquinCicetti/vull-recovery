# Design

## Theme
**Matte-black, industrial / devtool** (Vercel / Linear / NVIDIA vibes). Scene: an
athlete checking recovery-session availability on their phone in a gym between
training blocks, wanting it to feel precise, fast, and serious about performance.
High contrast, sharp geometry, thin borders, one signal green. Light mode is not
offered.

## Color
Strategy: **Restrained** — near-neutral dark surfaces, green used *only* for
primary actions and state (never decoration). High contrast.

| token | hex | use |
|-------|-----|-----|
| `bg` | `#000000` | page background (matte black) |
| `surface` | `#0D0D0D` | cards, header |
| `surface-2` | `#161616` | inputs, raised |
| `border` | `#262626` | hairlines |
| `border-strong` | `#3A3A3A` | hover / emphasis borders |
| `fg` | `#F4F4F4` | primary text |
| `fg-muted` | `#BDBDBD` | secondary text |
| `fg-faint` | `#7D7D7D` | tertiary / placeholder |
| `accent` | `#61B33B` | primary actions, active, positive (warm grass green) |
| `accent-hover` | `#6CCB45` | hover |
| `accent-dark` | `#3E7D25` | pressed / deep accent |
| `on-accent` | `#0A0F08` | text on green fills (dark, high contrast) |
| `danger` | `#E5484D` | destructive / rejected |

Subtle green glow allowed (a faint radial from the top). Status chips use dark
tints and are **always labeled**: confirmed → green; pending → amber;
awaiting_payment → cool blue; cancelled/expired → faint on `surface-2`.

## Typography
**Geist Sans** (it's Vercel's typeface — on-brand for this lane) for UI, **Geist
Mono** for times, prices, IDs and numeric "data" (instrument feel). The
geometric-industrial character comes from treatment, not a novelty font:
- Headings: heavy weight, tight tracking (~-0.02em).
- Eyebrows / labels / wordmark: **UPPERCASE, wide tracking** (0.16–0.22em).
- Body ≤ 70ch; step ratio ≥ 1.25. Add line-height on light-on-dark text.

Avoid the brand reflex fonts; Geist is deliberate here, not a default.

## Geometry, spacing, motion
- **Sharp.** Small radii only (controls ~6px, cards ~8px). No pills, no large
  rounded "playful" corners, no organic shapes.
- **Thin borders** carry separation, not shadows. No soft drop shadows.
- Generous, sparse spacing; section padding > card padding. Mobile-first.
- Motion: **fast and precise** (120–180ms, ease-out). Hover/press feedback only;
  respect `prefers-reduced-motion`. No bounce, no layout-property animation.

## Components
- **Buttons:** `.btn-primary` (green fill + dark `on-accent` text), `.btn-ghost`
  (bordered, border brightens on hover). `rounded-md`, semibold.
- **Inputs:** `.field` (surface-2 fill, border, green focus ring).
- **Cards:** `.surface-card` (surface + 1px border, `rounded-lg`). No nested cards.
- **Chips** (`.chip`) for status; `.eyebrow` for uppercase labels.

## Logo
Bare mark (no tile) on the matte-black UI: a **white equilateral triangle** with a
**black negative-space diagonal cut**, and a **vivid green angular check/slash**
overlapping the cut. Reads as precision + verification + ascent. Wordmark in
uppercase wide tracking, hidden on the smallest screens (mark alone).

## Avoid (per brief)
Rounded playful UI, bright multi-color palettes, heavy gradients, soft shadows,
organic shapes, color used decoratively.
