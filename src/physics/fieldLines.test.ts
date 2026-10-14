import { describe, expect, it } from 'vitest'
import { makeDipole, totalField } from './dipole'
import { computeFieldLines, DEFAULT_TRACE, traceFieldLine, type Bounds, type TraceOptions } from './fieldLines'
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
