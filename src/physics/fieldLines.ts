import { coreHit, totalField, type Dipole } from './dipole'
import { add, distance, dot, fromAngle, isFiniteVec, length, scale, sub, type Vec2 } from './vec2'

export type FieldFn = (p: Vec2) => Vec2

export type StopReason =
  | 'core' // entered a magnet body
  | 'bounds' // left the simulation area
  | 'maxSteps' // step budget exhausted
  | 'weakField' // |B| too small for a reliable direction (near a null point)
  | 'closed' // returned to its starting point
  | 'nonFinite' // NaN / Infinity in the field or position

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface TraceOptions {
  /** Nominal arc length per step (m). */
  step: number
  /** Smallest step the adaptive control may use (m). */
  minStep: number
  /** Max direction change per step (rad); larger changes halve the step. */
  maxTurn: number
  maxSteps: number
  bounds: Bounds
  /** Stop when |B| falls below this fraction of |B| at the start point. */
  weakFieldRatio: number
  /** +1 traces along B, −1 against it. */
  direction: 1 | -1
  /** Dipole index whose core the line starts beside; ignored for the first steps. */
  startCore?: number
}

export interface FieldLine {
  points: Vec2[]
  stop: StopReason
  /** +1 if traced along B, -1 if traced against it (points then run opposite to B). */
  direction: 1 | -1
  /** Index of the dipole core the line ended in, if stop === 'core'. */
  endCore: number
}

export const DEFAULT_TRACE: Omit<TraceOptions, 'bounds' | 'direction'> = {
  step: 0.01,
  minStep: 0.0005,
  maxTurn: 0.15,
  maxSteps: 4000,
  weakFieldRatio: 1e-7,
}

const inBounds = (p: Vec2, b: Bounds) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY

/**
 * Traces a field line from `start` with RK4 on the unit direction B/|B|, so
 * the step is an arc length regardless of field strength. The step halves
 * when the line bends sharply, and tracing stops on any of `StopReason`.
 */
export function traceFieldLine(
  field: FieldFn,
  start: Vec2,
  opts: TraceOptions,
  dipoles: readonly Dipole[] = [],
): FieldLine {
  const points: Vec2[] = [start]
  const done = (stop: StopReason, endCore = -1): FieldLine => ({ points, stop, endCore, direction: opts.direction })
  const b0 = length(field(start))
  if (!Number.isFinite(b0)) return done('nonFinite')
  const weak = b0 * opts.weakFieldRatio
  if (b0 === 0) return done('weakField')

  // Unit direction; null when the field is unusable at p.
  let failure: StopReason | null = null
  const dir = (p: Vec2): Vec2 | null => {
    const b = field(p)
    if (!isFiniteVec(b)) {
      failure = 'nonFinite'
      return null
    }
    const m = length(b)
    if (m <= weak) {
      failure = 'weakField'
      return null
    }
    return scale(b, opts.direction / m)
  }

  let p = start
  let travelled = 0
  let h = opts.step
  for (let i = 0; i < opts.maxSteps; i++) {
    const k1 = dir(p)
    if (!k1) return done(failure!)

    let next: Vec2 | null = null
    while (true) {
      const k2 = dir(add(p, scale(k1, h / 2)))
      const k3 = k2 && dir(add(p, scale(k2, h / 2)))
      const k4 = k3 && dir(add(p, scale(k3, h)))
      if (!k2 || !k3 || !k4) return done(failure!)
      const turn = Math.acos(Math.min(1, Math.max(-1, dot(k1, k4))))
      if (turn > opts.maxTurn && h > opts.minStep) {
        h = Math.max(opts.minStep, h / 2)
        continue
      }
      next = add(p, scale(add(add(k1, scale(add(k2, k3), 2)), k4), h / 6))
      break
    }

    if (!isFiniteVec(next)) return done('nonFinite')
    travelled += h
    p = next
    points.push(p)
    // Let the step grow back after a sharp bend.
    h = Math.min(opts.step, h * 1.5)

    if (!inBounds(p, opts.bounds)) return done('bounds')
    const hit = coreHit(dipoles, p)
    if (hit >= 0 && !(hit === opts.startCore && travelled < 4 * opts.step)) {
      return done('core', hit)
    }
    if (travelled > 20 * opts.step && distance(p, start) < opts.step) {
      points.push(start)
      return done('closed')
    }
  }
  return done('maxSteps')
}

export interface FieldLineSetOptions {
  bounds: Bounds
  /** Lines per dipole for a moment of 1 A·m²; scaled by |m|. */
  linesPerUnitMoment: number
  minLinesPerDipole: number
  maxLinesPerDipole: number
  /** Seed circle radius as a multiple of the core radius. */
  seedRadiusFactor: number
  /** ε for the softened field (m). */
  softening: number
  trace?: Partial<Omit<TraceOptions, 'bounds' | 'direction' | 'startCore'>>
}

export const DEFAULT_LINE_SET: Omit<FieldLineSetOptions, 'bounds'> = {
  linesPerUnitMoment: 28,
  minLinesPerDipole: 8,
  maxLinesPerDipole: 40,
  seedRadiusFactor: 1.05,
  softening: 0.01,
}

/**
 * Seeds points evenly round each dipole (count ∝ |m|). Seeds where B points
 * outward are traced along B; seeds where B points inward are traced against
 * B, and dropped if they end in a core, since an outward seed already
 * produced that line. This avoids drawing most lines twice.
 */
export function computeFieldLines(dipoles: readonly Dipole[], options: FieldLineSetOptions): FieldLine[] {
  const field: FieldFn = (p) => totalField(dipoles, p, options.softening)
  const lines: FieldLine[] = []
  dipoles.forEach((d, index) => {
    const m = length(d.moment)
    if (m === 0) return
    const count = Math.round(
      Math.min(options.maxLinesPerDipole, Math.max(options.minLinesPerDipole, m * options.linesPerUnitMoment)),
    )
    const axis = Math.atan2(d.moment.y, d.moment.x)
    const radius = d.coreRadius * options.seedRadiusFactor
    for (let k = 0; k < count; k++) {
      // Offset by half a slot so no seed sits exactly on the moment axis.
      const offset = fromAngle(axis + ((k + 0.5) / count) * 2 * Math.PI, radius)
      const seed = add(d.position, offset)
      if (coreHit(dipoles, seed) >= 0) continue
      const outward = dot(field(seed), sub(seed, d.position)) >= 0
      const line = traceFieldLine(
        field,
        seed,
        { ...DEFAULT_TRACE, ...options.trace, bounds: options.bounds, direction: outward ? 1 : -1, startCore: index },
        dipoles,
      )
      if (!outward && line.stop === 'core') continue
      lines.push(line)
    }
  })
  return lines
}
