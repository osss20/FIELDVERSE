import { describe, expect, it } from 'vitest'
import { dBzdz, dipoleField, makeDipole, MU0_OVER_4PI, totalField } from './dipole'
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
