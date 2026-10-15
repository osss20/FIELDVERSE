import { describe, expect, it } from 'vitest'
import { dBzdz, dipoleField, makeDipole, MU0_OVER_4PI, STRENGTH, strengthOf, totalField, withStrength } from './dipole'
import { add, vec, type Vec2 } from './vec2'

const k = MU0_OVER_4PI
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)

describe('dipoleField', () => {
  const m = 2.5
  const d = makeDipole('a', 0, 0, m, 0)

  it('matches the on-axis value B = (μ0/4π)·2m/r³', () => {
    for (const r of [0.2, 0.5, 1, 3]) {
      const b = dipoleField(d, vec(r, 0))
      expect(rel(b.x, (2 * k * m) / r ** 3)).toBeLessThan(1e-12)
      expect(Math.abs(b.y)).toBeLessThan(1e-20)
    }
  })

  it('matches the equatorial value B = −(μ0/4π)·m/r³', () => {
    for (const r of [0.2, 0.5, 1, 3]) {
      const b = dipoleField(d, vec(0, r))
      expect(rel(b.x, (-k * m) / r ** 3)).toBeLessThan(1e-12)
      expect(Math.abs(b.y)).toBeLessThan(1e-20)
    }
  })

  it('is rotation-covariant: rotating the moment rotates the field', () => {
    const rotated = makeDipole('b', 0, 0, 0, m)
    const b = dipoleField(rotated, vec(0, 0.7))
    expect(rel(b.y, (2 * k * m) / 0.7 ** 3)).toBeLessThan(1e-12)
  })

  it('stays finite at the centre with softening and returns zero without it', () => {
    const soft = dipoleField(d, vec(0, 0), 0.01)
    expect(Number.isFinite(soft.x) && Number.isFinite(soft.y)).toBe(true)
    expect(dipoleField(d, vec(0, 0))).toEqual({ x: 0, y: 0 })
  })

  it('softening is negligible far from the core', () => {
    const p = vec(0.6, 0.4)
    const exact = dipoleField(d, p)
    const soft = dipoleField(d, p, 0.01)
    expect(rel(soft.x, exact.x)).toBeLessThan(1e-3)
    expect(rel(soft.y, exact.y)).toBeLessThan(1e-3)
  })
})

describe('superposition and field identities', () => {
  const dipoles = [makeDipole('a', -0.4, 0.1, 1, 0.3), makeDipole('b', 0.5, -0.2, -0.4, 1.2)]

  it('total field is the sum of individual fields', () => {
    const p = vec(0.1, 0.7)
    const sum = add(dipoleField(dipoles[0], p), dipoleField(dipoles[1], p))
    const total = totalField(dipoles, p)
    expect(rel(total.x, sum.x)).toBeLessThan(1e-14)
    expect(rel(total.y, sum.y)).toBeLessThan(1e-14)
  })

  const h = 1e-5
  const deriv = (f: (p: Vec2) => number, p: Vec2, axis: 'x' | 'y') => {
    const dp = axis === 'x' ? vec(h, 0) : vec(0, h)
    return (f(add(p, dp)) - f(add(p, vec(-dp.x, -dp.y)))) / (2 * h)
  }

  it('is curl-free away from sources (∂By/∂x − ∂Bx/∂y ≈ 0)', () => {
    for (const p of [vec(0.1, 0.7), vec(-1, -0.6), vec(1.2, 0.3)]) {
      const curl =
        deriv((q) => totalField(dipoles, q).y, p, 'x') - deriv((q) => totalField(dipoles, q).x, p, 'y')
      const scaleB = Math.hypot(totalField(dipoles, p).x, totalField(dipoles, p).y)
      expect(Math.abs(curl) / scaleB).toBeLessThan(1e-6)
    }
  })

  it('is divergence-free in 3D (∂Bx/∂x + ∂By/∂y + ∂Bz/∂z ≈ 0)', () => {
    for (const p of [vec(0.1, 0.7), vec(-1, -0.6), vec(1.2, 0.3)]) {
      const div =
        deriv((q) => totalField(dipoles, q).x, p, 'x') +
        deriv((q) => totalField(dipoles, q).y, p, 'y') +
        dBzdz(dipoles, p)
      const scaleB = Math.hypot(totalField(dipoles, p).x, totalField(dipoles, p).y)
      expect(Math.abs(div) / scaleB).toBeLessThan(1e-6)
    }
  })

  it('two identical dipoles on the x axis give a mirror-symmetric field', () => {
    const pair = [makeDipole('l', -0.5, 0, 1, 0), makeDipole('r', 0.5, 0, 1, 0)]
    for (const p of [vec(0.3, 0.4), vec(1.1, -0.2), vec(0.05, 0.9)]) {
      const a = totalField(pair, p)
      const b = totalField(pair, vec(-p.x, p.y))
      expect(rel(a.x, b.x)).toBeLessThan(1e-12)
      expect(rel(a.y, -b.y)).toBeLessThan(1e-12)
    }
  })
})

describe('magnet strength', () => {
  const a = makeDipole('a', -0.4, 0.1, 0.6, 0.8) // |m| = 1
  const b = makeDipole('b', 0.5, -0.2, -0.4, 1.2)

  it('sets |m| and keeps the moment direction', () => {
    const s = withStrength(a, 3)
    expect(strengthOf(s)).toBeCloseTo(3, 12)
    expect(s.moment.x / s.moment.y).toBeCloseTo(0.6 / 0.8, 12)
    expect(s.position).toEqual(a.position)
  })

  it('scales the field linearly, as B ∝ m in the dipole model', () => {
    const p = vec(0.3, 0.9)
    const b1 = dipoleField(a, p)
    const b3 = dipoleField(withStrength(a, 2.5), p)
    expect(rel(b3.x, 2.5 * b1.x)).toBeLessThan(1e-12)
    expect(rel(b3.y, 2.5 * b1.y)).toBeLessThan(1e-12)
  })

  it('changes one magnet only and superposition still holds', () => {
    const p = vec(0.1, 0.7)
    const before = [a, b]
    const after = before.map((d) => (d.id === 'a' ? withStrength(d, 4) : d))
    expect(after[1]).toBe(b) // untouched object
    expect(before[0].moment).toEqual(a.moment) // original not mutated
    const sum = add(dipoleField(after[0], p), dipoleField(after[1], p))
    const total = totalField(after, p)
    expect(rel(total.x, sum.x)).toBeLessThan(1e-14)
    expect(rel(total.y, sum.y)).toBeLessThan(1e-14)
    // The change in the total field is exactly the change in a's own field.
    const delta = totalField(after, p).x - totalField(before, p).x
    expect(rel(delta, 3 * dipoleField(a, p).x)).toBeLessThan(1e-9)
  })

  it('clamps to the documented range and rejects invalid values', () => {
    expect(strengthOf(withStrength(a, 100))).toBeCloseTo(STRENGTH.max, 12)
    expect(strengthOf(withStrength(a, 0))).toBeCloseTo(STRENGTH.min, 12)
    expect(strengthOf(withStrength(a, -2))).toBeCloseTo(STRENGTH.min, 12)
    expect(strengthOf(withStrength(a, Number.NaN))).toBeCloseTo(STRENGTH.default, 12)
    expect(strengthOf(withStrength(a, Infinity))).toBeCloseTo(STRENGTH.default, 12)
  })

  it('gives a zero-moment magnet a valid direction when strength is set', () => {
    const z = withStrength(makeDipole('z', 0, 0, 0, 0), 2)
    expect(z.moment).toEqual({ x: 2, y: 0 })
  })
})
