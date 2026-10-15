import { coreHit, strengthOf, totalField, type Dipole } from './dipole'
import { add, distance, dot, fromAngle, isFiniteVec, length, scale, type Vec2 } from './vec2'

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
  /** Lines per dipole for |m| = 1 A·m²; the count is proportional to |m|. */
  linesPerUnitMoment: number
  /** Visual floor so very weak magnets still show their shape. */
  minLinesPerDipole: number
  maxLinesPerDipole: number
  /** Cap on lines across all magnets; counts are scaled down proportionally. */
  maxTotalLines?: number
  /** Seed circle radius as a multiple of the core radius. */
  seedRadiusFactor: number
  /** Flux samples taken round each seed circle. */
  fluxSamples?: number
  /** ε for the softened field (m). */
  softening: number
  trace?: Partial<Omit<TraceOptions, 'bounds' | 'direction' | 'startCore'>>
}

export const DEFAULT_LINE_SET: Omit<FieldLineSetOptions, 'bounds'> = {
  linesPerUnitMoment: 20,
  minLinesPerDipole: 6,
  maxLinesPerDipole: 80,
  maxTotalLines: 240,
  seedRadiusFactor: 1.05,
  fluxSamples: 360,
  softening: 0.01,
}

export interface Seed {
  point: Vec2
  /** True where B points out of the seed circle (traced along B). */
  outward: boolean
}

const validDipole = (d: Dipole) =>
  isFiniteVec(d.position) && isFiniteVec(d.moment) && Number.isFinite(d.coreRadius) && d.coreRadius > 0

/** Lines per dipole before the global cap: proportional to |m|, clamped. */
export function lineCounts(dipoles: readonly Dipole[], options: Omit<FieldLineSetOptions, 'bounds'>): number[] {
  const raw = dipoles.map((d) => {
    const m = strengthOf(d)
    if (!validDipole(d) || !(m > 0)) return 0
    return Math.round(Math.min(options.maxLinesPerDipole, Math.max(options.minLinesPerDipole, m * options.linesPerUnitMoment)))
  })
  const total = raw.reduce((a, b) => a + b, 0)
  const cap = options.maxTotalLines ?? Infinity
  if (total <= cap) return raw
  const f = cap / total
  return raw.map((n) => (n === 0 ? 0 : Math.max(2, Math.floor(n * f))))
}

/**
 * Flux-weighted seeds on a circle round dipole `index`.
 *
 * The normal component B·n̂ of the total field is sampled round the circle.
 * Outward seeds sit at equal quantiles of the outward flux and inward seeds at
 * equal quantiles of the inward flux, so neighbouring lines bound equal flux
 * and line density follows field strength (Faraday's picture). For a lone
 * dipole B·n̂ ∝ cos θ, which gives seeds equally spaced in sin θ.
 *
 * Approximation: this is flux through a circle in the 2D slice, not through
 * a sphere in 3D, so line density in the picture is qualitative.
 */
export function fluxSeeds(
  dipoles: readonly Dipole[],
  index: number,
  count: number,
  options: Pick<FieldLineSetOptions, 'seedRadiusFactor' | 'softening' | 'fluxSamples'>,
): Seed[] {
  const d = dipoles[index]
  if (count <= 0 || !validDipole(d)) return []
  const samples = options.fluxSamples ?? 360
  const radius = d.coreRadius * options.seedRadiusFactor
  const axis = Math.atan2(d.moment.y, d.moment.x)
  const dphi = (2 * Math.PI) / samples
  const flux: number[] = []
  let pos = 0
  let neg = 0
  for (let j = 0; j < samples; j++) {
    const n = fromAngle(axis + (j + 0.5) * dphi)
    const p = add(d.position, scale(n, radius))
    // Points inside another magnet cannot seed a visible line.
    const blocked = coreHit(dipoles, p) >= 0
    const f = blocked ? 0 : dot(totalField(dipoles, p, options.softening), n)
    const v = Number.isFinite(f) ? f : 0
    flux.push(v)
    if (v > 0) pos += v
    else neg -= v
  }
  if (!(pos + neg > 0)) return []

  const nOut = Math.round((count * pos) / (pos + neg))
  const seeds: Seed[] = []
  const place = (n: number, total: number, sign: 1 | -1) => {
    if (n <= 0 || total <= 0) return
    let k = 0
    let acc = 0
    for (let j = 0; j < samples && k < n; j++) {
      const f = sign * flux[j]
      if (f <= 0) continue
      // Place every quantile target that falls inside this sample's bin.
      while (k < n && acc + f >= ((k + 0.5) / n) * total) {
        const t = (((k + 0.5) / n) * total - acc) / f
        const dir = fromAngle(axis + (j + t) * dphi)
        const point = add(d.position, scale(dir, radius))
        // Interpolating within a bin can cross into a neighbouring core.
        if (coreHit(dipoles, point) < 0) seeds.push({ point, outward: sign === 1 })
        k++
      }
      acc += f
    }
  }
  place(nOut, pos, 1)
  place(count - nOut, neg, -1)
  return seeds
}

/**
 * Traces flux-weighted seeds round every dipole. Outward seeds are traced
 * along B; inward seeds against B, and dropped if they end in a core, because
 * an outward seed elsewhere already drew that line. Lines that enter from
 * outside the view are kept, so nothing visible is lost.
 */
export function computeFieldLines(dipoles: readonly Dipole[], options: FieldLineSetOptions): FieldLine[] {
  const field: FieldFn = (p) => totalField(dipoles, p, options.softening)
  const counts = lineCounts(dipoles, options)
  const lines: FieldLine[] = []
  dipoles.forEach((_, index) => {
    for (const seed of fluxSeeds(dipoles, index, counts[index], options)) {
      const line = traceFieldLine(
        field,
        seed.point,
        {
          ...DEFAULT_TRACE,
          ...options.trace,
          bounds: options.bounds,
          direction: seed.outward ? 1 : -1,
          startCore: index,
        },
        dipoles,
      )
      if (!seed.outward && line.stop === 'core') continue
      lines.push(line)
    }
  })
  return lines
}
