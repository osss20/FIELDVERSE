import { makeDipole, type Dipole } from '../physics/dipole'
import { fromAngle } from '../physics/vec2'

export interface Preset {
  id: string
  name: string
  /** One sentence on the physics the preset shows. */
  principle: string
  build: () => Dipole[]
}

const at = (id: string, x: number, y: number, degrees: number, strength = 1): Dipole => {
  const m = fromAngle((degrees * Math.PI) / 180, strength)
  return makeDipole(id, x, y, m.x, m.y)
}

/** The starting layout, restored by Reset. */
export const FREE_EXPERIMENT: Preset = {
  id: 'free',
  name: 'Free experiment',
  principle: 'Two bar magnets far enough apart to rest. Drag, rotate, flip or strengthen them to make them interact.',
  build: () => [at('m1', -0.6, 0, 0), at('m2', 0.6, 0, 0)],
}

/**
 * Preset experiments. Distances are chosen against the simulation's friction
 * threshold: the first two start inside interaction range so they move on
 * their own; the others start at rest so the field pattern can be studied.
 */
export const PRESETS: readonly Preset[] = [
  FREE_EXPERIMENT,
  {
    id: 'like-repel',
    name: 'Like-pole repulsion',
    principle: 'Two north poles face each other. Like poles repel, so the magnets push apart until friction holds them.',
    build: () => [at('m1', -0.15, 0, 0), at('m2', 0.15, 0, 180)],
  },
  {
    id: 'opposite-attract',
    name: 'Opposite-pole attraction',
    principle: 'A north pole faces a south pole. Opposite poles attract, so the magnets pull together and snap into contact.',
    build: () => [at('m1', -0.21, 0, 0), at('m2', 0.21, 0, 0)],
  },
  {
    id: 'aligned',
    name: 'Aligned poles',
    principle: 'Three magnets point the same way. Field lines run from each north pole into the next south pole, so the fields add along the row.',
    build: () => [at('m1', -0.8, 0, 0), at('m2', 0, 0, 0), at('m3', 0.8, 0, 0)],
  },
  {
    id: 'orientations',
    name: 'Different orientations',
    principle: 'Magnets at different angles bend each other’s field lines. Each feels a torque towards the other’s field; drag them closer to see them turn.',
    build: () => [at('m1', -0.45, -0.1, 0), at('m2', 0.45, 0.1, 90)],
  },
  {
    id: 'multiple',
    name: 'Combined field',
    principle: 'With several magnets, the field at every point is the vector sum of each magnet’s own field (superposition).',
    build: () => [
      at('m1', -1, 0.55, 0),
      at('m2', 1, 0.55, 180),
      at('m3', 0, -0.05, 90),
      at('m4', -0.85, -0.75, 45),
      at('m5', 0.85, -0.75, -45),
    ],
  },
]

export const presetById = (id: string): Preset => PRESETS.find((p) => p.id === id) ?? FREE_EXPERIMENT
