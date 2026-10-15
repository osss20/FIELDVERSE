# FIELDVERSE

Interactive 2D magnetic-field lab. Drag, rotate, flip and strengthen bar magnets; watch them attract, repel and
snap together; hear the interactions; and see the field lines update live. Preset experiments cover like-pole
repulsion, opposite-pole attraction, aligned poles, different orientations and combined fields.

## Physics

- Each magnet is a point dipole; the view is the z = 0 slice of the 3D dipole field
  B = (μ0/4π) · (3(m·r)r/r⁵ − m/r³), in SI units.
- The total field is the vector sum of every dipole (superposition).
- Field lines are traced with RK4 along B/|B| with adaptive step halving on sharp bends.
  Tracing stops on entering a magnet core, leaving the view, a weak field (null point),
  a closed loop, a step budget, or any non-finite value. A small softening keeps B finite at dipole centres.

### Magnet strength

Strength is the dipole moment magnitude |m| in A·m², adjustable per magnet from 0.1 to 5 (default 1).
These are **model values** for exploring field shape, not calibrated measurements of real magnets.
B scales linearly with |m|; changing one magnet never alters another.

### Field-line seeding (visual approximation)

Seeds sit on a small circle round each magnet at equal quantiles of the flux B·n̂ of the *total* field
through that circle, so neighbouring lines bound equal flux and line density follows field strength.
For a lone dipole this spaces seeds equally in sin θ from the axis. Line count per magnet is
proportional to |m| (20 per A·m²), with a floor of 6 so weak magnets stay visible, a cap of 80 per
magnet, and 240 overall (scaled down proportionally). The flux is through a circle in the 2D slice,
not a sphere in 3D, so line density is qualitative rather than a quantitative |B| map.

### Magnet-to-magnet forces (src/physics/interaction.ts)

Forces and torques use the exact point-dipole interaction, derived from the same field that is drawn:
F = −∇U and τ = m × B with U = −m·B. For two magnets with r̂ from a to b,
F_b = 3(μ0/4π)/r⁴ · [(mₐ·r̂)m_b + (m_b·r̂)mₐ + (mₐ·m_b)r̂ − 5(mₐ·r̂)(m_b·r̂)r̂].
Facing opposite poles attract and like poles repel, side-by-side parallel magnets repel, and the force
falls off as 1/r⁴ and scales with both strengths. Tests check these cases, Newton's third law, and
F = −∇U against the drawn field numerically.

**Limits:** real bar magnets are not point dipoles, so near contact the real force differs; strengths
are model values, so forces are model quantities. Centre distances below 5 cm are clamped to keep
forces finite.

### Tabletop dynamics (src/model/simulation.ts)

A simplified, explicitly non-rigid-body model on top of those forces:

- **Static friction:** a magnet stays put until the net force exceeds 1.5×10⁻⁵ N (torque: 5×10⁻⁶ N·m),
  so distant magnets rest and strength changes the reach (force ∝ |m₁||m₂|).
- **Overdamped motion:** above the threshold, velocity ∝ excess force, with no inertia, so nothing
  overshoots or oscillates. Speeds are capped.
- **Attachment:** an attracting pair that comes within contact range attaches and closes to a 2 mm gap.
  It separates when its own force turns repulsive (e.g. after a flip) or when the user pulls a held
  magnet more than 8 cm past its contact position.
- **Held magnets** are offset from the pointer by the net force on them, capped at 10 cm, so you can see
  them resist like poles and get pulled by opposite ones.
- Attract/repel events use hysteresis, so they fire once per transition, not every frame.

All constants are model values chosen for a readable experiment. On screen, the "interaction strength"
meter and force-arrow lengths are relative (0.5 = the friction threshold), never newtons.

### Sound (src/audio)

The Web Audio API synthesises the sounds: no audio files and no external services. Repel is a soft low
push, attract a rising pull, attach a crisp snap, plus small cues for detach, add and remove. The
AudioContext is created on the first pointer or key press (browser autoplay rules). A per-kind and
per-pair cooldown gate stops repeats during dragging. Sound can be turned off. Without Web Audio, the
app stays silent and keeps working.

### Magnet bodies and overlap

Each magnet is drawn as a bar (2·r_core × 0.8·r_core) inside its core circle. Moves, rotations and new
magnets keep bars at least 2 cm apart (separating-axis test on the rotated bars). A blocked drag stops
at contact or slides along the free axis and shows a message; magnets that somehow overlap can always
be pulled apart.

### Visualisation

Field lines are shaded by log|B| (brighter and thicker = stronger) and carry direction arrows. A dashed
overlay drifts along B. With *prefers-reduced-motion* the drift and expanding pulses are off. Glows
mark attracting (cyan) and repelling (violet) pole pairs, and amber arrows show the net force and torque
on each magnet. Field lines and forces can each be toggled.

Code: `src/physics` (fields, field lines, forces), `src/model` (shapes, overlap, simulation, presets,
feedback text), `src/audio` (sound), and `src/view` (React components and the Canvas renderer).
Physics, model and audio logic are pure or injectable and unit-tested.

## Development

```bash
npm install
npm run dev      # start the dev server
npm run check    # typecheck, lint, tests, production build
```

## Preview and CI

- **CI:** `.github/workflows/deploy-pages.yml` runs `npm run check` on every push to `main`.
- **Live site:** https://osss20.github.io/FIELDVERSE/ — the same workflow deploys `dist/` to GitHub Pages
  (Settings → Pages → Source: *GitHub Actions*) after the checks pass. If Pages is ever disabled, the
  deploy is skipped instead of failing. The base path comes from `actions/configure-pages`.
- **Private preview:** `npm run build:preview` builds `dist-preview/` with relative asset paths for a
  private claude.ai Artifact. It is republished manually, not on every push.

After cloning, enable the auto-push hook: `git config core.hooksPath .githooks` (see `CLAUDE.md`).
