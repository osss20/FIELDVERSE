import { describe, expect, it } from 'vitest'
import { makeDipole, totalField, withStrength } from './dipole'
import {
  computeFieldLines,
  DEFAULT_LINE_SET,
  DEFAULT_TRACE,
  fluxSeeds,
  lineCounts,
  traceFieldLine,
  type Bounds,
  type TraceOptions,
} from './fieldLines'
import { length, sub, vec } from './vec2'

const bounds: Bounds = { minX: -3, minY: -3, maxX: 3, maxY: 3 }
const opts = (o: Partial<TraceOptions> = {}): TraceOptions => ({
  ...DEFAULT_TRACE,
  bounds,
  direction: 1,
  ...o,
})

describe('traceFieldLine', () => {
  const d = makeDipole('a', 0, 0, 1, 0, 0.05)
  const field = (p: { x: number; y: number }) => totalField([d], p)

  it('follows the analytic dipole line r = L·sin²θ', () => {
    // Start just off the +x axis (north side), where θ is small.
    const theta0 = 0.5
    const r0 = 0.1
    const L = r0 / Math.sin(theta0) ** 2
    const line = traceFieldLine(field, vec(r0 * Math.cos(theta0), r0 * Math.sin(theta0)), opts({ startCore: 0 }), [d])
    expect(line.stop).toBe('core')
    expect(line.points.length).toBeGreaterThan(50)
    let worst = 0
    for (const p of line.points) {
      const r = length(p)
      if (r < 0.06) continue // final point sits inside the core
      const s = Math.abs(p.y) / r
      worst = Math.max(worst, Math.abs(r / (s * s) - L) / L)
    }
    expect(worst).toBeLessThan(1e-3)
  })

  it('ends in the core of the opposite magnet for an aligned pair', () => {
    const a = makeDipole('a', -0.5, 0, 1, 0, 0.05)
    const b = makeDipole('b', 0.5, 0, 1, 0, 0.05)
    const f = (p: { x: number; y: number }) => totalField([a, b], p)
    // Leaving a's north pole straight towards b's south pole.
    const line = traceFieldLine(f, vec(-0.44, 0.001), opts({ startCore: 0 }), [a, b])
    expect(line.stop).toBe('core')
    expect(line.endCore).toBe(1)
  })

  it('stops at the bounds', () => {
    const line = traceFieldLine(() => vec(1, 0), vec(0, 0), opts())
    expect(line.stop).toBe('bounds')
    expect(line.points.at(-1)!.x).toBeGreaterThan(bounds.maxX)
  })

  it('stops on a non-finite field instead of producing NaN points', () => {
    const line = traceFieldLine((p) => (p.x > 0.5 ? vec(Number.NaN, 0) : vec(1, 0)), vec(0, 0), opts())
    expect(line.stop).toBe('nonFinite')
    expect(line.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('stops near a null point instead of oscillating', () => {
    // B = (−x, 0) has a null at x = 0 approached from x > 0.
    const line = traceFieldLine((p) => vec(-p.x, 0), vec(1, 0), opts({ weakFieldRatio: 1e-3 }))
    expect(line.stop).toBe('weakField')
    expect(line.points.at(-1)!.x).toBeLessThan(0.01)
  })

  it('respects the step budget', () => {
    const line = traceFieldLine(() => vec(1, 0), vec(0, 0), opts({ maxSteps: 10 }))
    expect(line.stop).toBe('maxSteps')
    expect(line.points).toHaveLength(11)
  })

  it('detects closed loops', () => {
    // Circular field around the origin.
    const line = traceFieldLine((p) => vec(-p.y, p.x), vec(1, 0), opts())
    expect(line.stop).toBe('closed')
    expect(length(sub(line.points.at(-2)!, vec(1, 0)))).toBeLessThan(DEFAULT_TRACE.step)
  })
})

describe('computeFieldLines', () => {
  const base = { bounds, linesPerUnitMoment: 16, minLinesPerDipole: 8, maxLinesPerDipole: 40, seedRadiusFactor: 1.15, softening: 0.005 }

  it('draws each closed dipole line once and every line ends cleanly', () => {
    const d = makeDipole('a', 0, 0, 1, 0, 0.08)
    const lines = computeFieldLines([d], base)
    // 16 seeds: 8 outward lines, plus inward lines only where they enter from outside the view.
    expect(lines.length).toBeGreaterThanOrEqual(8)
    expect(lines.length).toBeLessThan(16)
    // No line was traced from both ends: no line ends next to another line's seed.
    for (const a of lines)
      for (const b of lines) if (a !== b) expect(length(sub(a.points.at(-1)!, b.points[0]))).toBeGreaterThan(0.02)
    for (const l of lines) {
      expect(['core', 'bounds']).toContain(l.stop)
      expect(l.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    }
  })

  it('scales the seed count with the moment and clamps it', () => {
    const weak = computeFieldLines([makeDipole('a', 0, 0, 0.1, 0)], base)
    const strong = computeFieldLines([makeDipole('a', 0, 0, 100, 0)], base)
    const outward = (ls: typeof weak) => ls.filter((l) => l.direction === 1).length
    expect(outward(weak)).toBe(4) // clamped up to 8 seeds, half outward
    expect(outward(strong)).toBe(20) // clamped down to 40 seeds, half outward
  })

  it('handles zero-moment and overlapping magnets without NaN', () => {
    const lines = computeFieldLines(
      [makeDipole('a', 0, 0, 0, 0), makeDipole('b', 0, 0, 1, 0), makeDipole('c', 0.01, 0, -1, 0)],
      base,
    )
    for (const l of lines) expect(l.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })
})

describe('flux-weighted seeding', () => {
  const seedOpts = { seedRadiusFactor: 1.05, softening: 0.01, fluxSamples: 720 }
  const finite = (p: { x: number; y: number }) => Number.isFinite(p.x) && Number.isFinite(p.y)

  it('spaces a lone dipole’s outward seeds equally in sin θ (equal flux per line)', () => {
    const d = makeDipole('a', 0.2, -0.1, 0, 2) // moment along +y
    const seeds = fluxSeeds([d], 0, 20, seedOpts)
    const out = seeds.filter((s) => s.outward)
    expect(out).toHaveLength(10)
    // θ from the moment axis; B·n̂ ∝ cos θ, so cumulative flux ∝ sin θ.
    const sines = out
      .map((s) => {
        const r = { x: s.point.x - d.position.x, y: s.point.y - d.position.y }
        return Math.sin(Math.atan2(-r.x, r.y)) // signed angle from +y
      })
      .sort((a, b) => a - b)
    for (let k = 0; k < sines.length; k++) {
      expect(Math.abs(sines[k] - (-1 + (2 * k + 1) / 10))).toBeLessThan(0.01)
    }
    // Every outward seed is on the north half, every inward one on the south half.
    for (const s of seeds) expect(s.point.y > d.position.y).toBe(s.outward)
  })

  it('puts more seeds near the poles than equal-angle spacing did', () => {
    const d = makeDipole('a', 0, 0, 1, 0)
    const out = fluxSeeds([d], 0, 40, seedOpts).filter((s) => s.outward)
    const nearPole = out.filter((s) => Math.abs(Math.atan2(s.point.y, s.point.x)) < Math.PI / 6).length
    // Equal angles give 1/3 of outward seeds within 30° of the axis; equal flux gives 1/2.
    expect(nearPole / out.length).toBeGreaterThan(0.45)
  })

  it('gives line counts proportional to strength', () => {
    const counts = lineCounts(
      [1, 2, 3].map((m, i) => withStrength(makeDipole(`m${i}`, i, 0, 1, 0), m)),
      DEFAULT_LINE_SET,
    )
    expect(counts[1]).toBe(2 * counts[0])
    expect(counts[2]).toBe(3 * counts[0])
  })

  it('keeps the total number of lines bounded', () => {
    const many = Array.from({ length: 12 }, (_, i) => makeDipole(`m${i}`, (i % 4) - 1.5, Math.floor(i / 4) - 1, 5, 0))
    const counts = lineCounts(many, DEFAULT_LINE_SET)
    expect(counts.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(DEFAULT_LINE_SET.maxTotalLines!)
    const lines = computeFieldLines(many, { ...DEFAULT_LINE_SET, bounds })
    expect(lines.length).toBeLessThanOrEqual(DEFAULT_LINE_SET.maxTotalLines!)
    for (const l of lines) expect(l.points.length).toBeLessThanOrEqual(DEFAULT_TRACE.maxSteps + 2)
  })

  it('never seeds inside another magnet', () => {
    const ds = [makeDipole('a', 0, 0, 1, 0), makeDipole('b', 0.2, 0, 1, 0)]
    for (let i = 0; i < ds.length; i++) {
      for (const s of fluxSeeds(ds, i, 40, seedOpts)) {
        ds.forEach((o, j) => {
          if (j !== i) expect(Math.hypot(s.point.x - o.position.x, s.point.y - o.position.y)).toBeGreaterThanOrEqual(o.coreRadius)
        })
      }
    }
  })

  it('skips invalid magnets instead of producing NaN lines', () => {
    const ds = [
      makeDipole('ok', 0, 0, 1, 0),
      makeDipole('nanPos', Number.NaN, 0, 1, 0),
      makeDipole('infMoment', 0.8, 0, Infinity, 0),
      makeDipole('zero', -0.8, 0, 0, 0),
    ]
    expect(lineCounts(ds, DEFAULT_LINE_SET).slice(1)).toEqual([0, 0, 0])
    expect(fluxSeeds(ds, 1, 10, seedOpts)).toEqual([])
    // The NaN-position magnet poisons the total field everywhere; tracing must stop cleanly.
    for (const l of computeFieldLines(ds, { ...DEFAULT_LINE_SET, bounds })) {
      expect(l.points.every(finite)).toBe(true)
    }
  })

  it('field-line direction still follows B for flux-weighted seeds', () => {
    const ds = [makeDipole('a', -0.5, 0, 1, 0), withStrength(makeDipole('b', 0.6, 0.3, 0, 1), 2.5)]
    for (const l of computeFieldLines(ds, { ...DEFAULT_LINE_SET, bounds })) {
      if (l.points.length < 3) continue
      const p = l.points[1]
      const step = { x: (l.points[2].x - p.x) * l.direction, y: (l.points[2].y - p.y) * l.direction }
      const b = totalField(ds, p, DEFAULT_LINE_SET.softening)
      expect(step.x * b.x + step.y * b.y).toBeGreaterThan(0)
    }
  })
})
