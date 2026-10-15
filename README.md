# FIELDVERSE

Interactive 2D magnetic-field simulator. Place, move and rotate bar magnets and see their field lines update live.

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

### Magnet bodies and overlap

Each magnet is drawn as a bar (2·r_core × 0.8·r_core) inside its core circle. Moves, rotations and new
magnets keep bars at least 2 cm apart (separating-axis test on the rotated bars). A blocked drag stops
at contact or slides along the free axis and shows a message; magnets that somehow overlap can always
be pulled apart.

Code: `src/physics` (fields and field lines), `src/model` (magnet shapes and overlap), and
`src/view` (Canvas rendering and controls). Physics and model code are pure and unit-tested.

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
