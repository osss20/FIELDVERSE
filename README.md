# FIELDVERSE

Interactive 2D magnetic-field simulator. Place, move and rotate bar magnets and see their field lines update live.

## Physics

- Each magnet is a point dipole; the view is the z = 0 slice of the 3D dipole field
  B = (μ0/4π) · (3(m·r)r/r⁵ − m/r³), in SI units.
- The total field is the vector sum of every dipole (superposition).
- Field lines are traced with RK4 along B/|B| with adaptive step halving on sharp bends.
  Tracing stops on entering a magnet core, leaving the view, a weak field (null point),
  a closed loop, a step budget, or any non-finite value. A small softening keeps B finite at dipole centres.

Code: `src/physics` (pure, unit-tested) and `src/view` (Canvas rendering and interaction).

## Development

```bash
npm install
npm run dev      # start the dev server
npm run check    # typecheck, lint, tests, production build
```

After cloning, enable the auto-push hook: `git config core.hooksPath .githooks` (see `CLAUDE.md`).
