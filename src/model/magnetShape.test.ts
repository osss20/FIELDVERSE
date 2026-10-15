import { describe, expect, it } from 'vitest'
import { makeDipole, withStrength, type Dipole } from '../physics/dipole'
import { vec } from '../physics/vec2'
import {
  bodyHalfLength,
  bodyHalfWidth,
  CLEARANCE,
  constrainMove,
  constrainRotate,
  findFreeSpot,
  hitsBody,
  overlapDepth,
  penetration,
} from './magnetShape'

// Default core radius 0.12 m → body 0.24 m × 0.096 m.
const a = makeDipole('a', 0, 0, 1, 0)
const L = bodyHalfLength(a)
const W = bodyHalfWidth(a)
const clear = (ds: readonly Dipole[]) => ds.every((d) => overlapDepth(d, ds) === 0)

describe('penetration', () => {
  it('is zero when bodies are at least the clearance apart and positive when closer', () => {
    const touchingGap = makeDipole('b', 2 * L + CLEARANCE + 1e-6, 0, 1, 0)
    const tooClose = makeDipole('b', 2 * L + CLEARANCE / 2, 0, 1, 0)
    expect(penetration(a, touchingGap)).toBe(0)
    expect(penetration(a, tooClose)).toBeGreaterThan(0)
  })

  it('uses the rotated bar shape, not a circle', () => {
    // Side by side: bars are thin, so they fit closer vertically than horizontally.
    const above = makeDipole('b', 0, 2 * W + CLEARANCE + 1e-6, 1, 0)
    expect(penetration(a, above)).toBe(0)
    // Rotating b by 90° makes it tall, so the same spot now overlaps.
    const aboveRotated = makeDipole('b', 0, 2 * W + CLEARANCE + 1e-6, 0, 1)
    expect(penetration(a, aboveRotated)).toBeGreaterThan(0)
  })

  it('does not depend on strength (size is fixed)', () => {
    const b = makeDipole('b', 0.2, 0.05, 1, 0)
    expect(penetration(a, withStrength(b, 5))).toBeCloseTo(penetration(a, b), 12)
  })
})

describe('hitsBody', () => {
  it('matches the rotated rectangle', () => {
    const r = makeDipole('r', 0, 0, 0, 1) // vertical bar
    expect(hitsBody(r, vec(0, L * 0.9))).toBe(true)
    expect(hitsBody(r, vec(L * 0.9, 0))).toBe(false)
  })
})

describe('constrainMove', () => {
  const b = makeDipole('b', 0.6, 0, 1, 0)

  it('allows free moves unchanged', () => {
    const r = constrainMove([a, b], 'b', vec(0.6, 0.5))
    expect(r).toEqual({ value: vec(0.6, 0.5), blocked: false })
  })

  it('stops at contact instead of overlapping', () => {
    const r = constrainMove([a, b], 'b', vec(0, 0))
    expect(r.blocked).toBe(true)
    const moved = { ...b, position: r.value }
    expect(clear([a, moved])).toBe(true)
    // It got close: within 1 mm of the clearance boundary.
    expect(r.value.x).toBeLessThan(2 * L + CLEARANCE + 1e-3)
  })

  it('slides along an obstacle when one axis of the drag is free', () => {
    const near = { ...b, position: vec(2 * L + CLEARANCE + 0.01, 0) }
    // Drag diagonally into a: the x part is blocked, the y part is free.
    const r = constrainMove([a, near], 'b', vec(0, 0.05))
    expect(r.blocked).toBe(true)
    expect(r.value.y).toBeCloseTo(0.05, 9)
    // x advances to the clearance boundary and no further.
    expect(r.value.x).toBeCloseTo(2 * L + CLEARANCE, 5)
    expect(clear([a, { ...near, position: r.value }])).toBe(true)
  })

  it('never lets a long drag tunnel into an overlap at the target', () => {
    for (const target of [vec(0.05, 0.01), vec(-0.1, 0.02), vec(0.1, -0.03)]) {
      const r = constrainMove([a, b], 'b', target)
      expect(clear([a, { ...b, position: r.value }])).toBe(true)
    }
  })

  it('lets magnets that already overlap be pulled apart, not stuck', () => {
    const stacked = makeDipole('b', 0.02, 0, 1, 0)
    expect(overlapDepth(stacked, [a, stacked])).toBeGreaterThan(0)
    const apart = constrainMove([a, stacked], 'b', vec(0.1, 0))
    expect(apart.blocked).toBe(false)
    expect(apart.value).toEqual(vec(0.1, 0))
    // Pushing deeper in is refused.
    const deeper = constrainMove([a, stacked], 'b', vec(0, 0))
    expect(overlapDepth({ ...stacked, position: deeper.value }, [a])).toBeLessThanOrEqual(
      overlapDepth(stacked, [a]) + 1e-9,
    )
  })

  it('ignores non-finite targets', () => {
    const r = constrainMove([a, b], 'b', vec(Number.NaN, 0))
    expect(r).toEqual({ value: b.position, blocked: true })
  })
})

describe('constrainRotate', () => {
  it('allows rotation when there is room', () => {
    const b = makeDipole('b', 0.6, 0, 1, 0)
    const r = constrainRotate([a, b], 'b', Math.PI / 2)
    expect(r.blocked).toBe(false)
    expect(r.value.x).toBeCloseTo(0, 12)
    expect(r.value.y).toBeCloseTo(1, 12)
  })

  it('stops rotating before the bar swings into a neighbour, keeping strength', () => {
    // b sits just above a; standing it upright would hit a.
    const b = withStrength(makeDipole('b', 0, 2 * W + CLEARANCE + 0.005, 1, 0), 2)
    const r = constrainRotate([a, b], 'b', Math.PI / 2)
    expect(r.blocked).toBe(true)
    expect(Math.hypot(r.value.x, r.value.y)).toBeCloseTo(2, 12)
    expect(clear([a, { ...b, moment: r.value }])).toBe(true)
  })

  it('flipping (180°) keeps the same footprint', () => {
    const b = makeDipole('b', 2 * L + CLEARANCE + 0.001, 0, 1, 0)
    expect(penetration(a, { ...b, moment: vec(-1, 0) })).toBe(penetration(a, b))
  })
})

describe('findFreeSpot', () => {
  it('returns the preferred spot when free, and a clear spot otherwise', () => {
    const c = makeDipole('c', 0, 0, 0, -1)
    expect(findFreeSpot([a], c, vec(0, 0.8), vec(1.6, 1.3))).toEqual(vec(0, 0.8))
    const spot = findFreeSpot([a], c, vec(0, 0), vec(1.6, 1.3))!
    expect(clear([a, { ...c, position: spot }])).toBe(true)
  })

  it('returns null when nothing fits', () => {
    const c = makeDipole('c', 0, 0, 0, -1)
    expect(findFreeSpot([a], c, vec(0, 0), vec(0.05, 0.05))).toBeNull()
  })
})
