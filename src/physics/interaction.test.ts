import { describe, expect, it } from 'vitest'
import { dipoleField, makeDipole, MU0_OVER_4PI, withStrength } from './dipole'
import {
  dipoleForce,
  dipoleTorque,
  interactionLevel,
  netLoads,
  pairInteraction,
  polePairing,
} from './interaction'
import { scale, vec } from './vec2'

const k = MU0_OVER_4PI
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300)
const flip = <T extends { moment: { x: number; y: number } }>(d: T): T => ({ ...d, moment: scale(d.moment, -1) })

describe('attraction and repulsion (point-dipole force)', () => {
  it('opposite poles facing (N→S, head to tail) attract with |F| = 6(μ0/4π)m²/r⁴', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    const b = makeDipole('b', 0.5, 0, 1, 0) // a's N faces b's S
    const p = pairInteraction(a, b)
    expect(p.kind).toBe('attract')
    expect(p.force.x).toBeLessThan(0) // b pulled towards a
    expect(rel(p.magnitude, (6 * k) / 0.5 ** 4)).toBeLessThan(1e-12)
    expect(polePairing(a, b, 0.12, 0.12)).toMatchObject({ a: 'N', b: 'S', like: false })
  })

  it('like poles facing (N–N) repel with the same magnitude', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    const b = makeDipole('b', 0.5, 0, -1, 0) // both N ends face each other
    const p = pairInteraction(a, b)
    expect(p.kind).toBe('repel')
    expect(p.force.x).toBeGreaterThan(0)
    expect(rel(p.magnitude, (6 * k) / 0.5 ** 4)).toBeLessThan(1e-12)
    expect(polePairing(a, b, 0.12, 0.12)).toMatchObject({ a: 'N', b: 'N', like: true })
  })

  it('S–S facing also repels', () => {
    const a = makeDipole('a', 0, 0, -1, 0)
    const b = makeDipole('b', 0.5, 0, 1, 0)
    expect(pairInteraction(a, b).kind).toBe('repel')
    expect(polePairing(a, b, 0.12, 0.12)).toMatchObject({ a: 'S', b: 'S', like: true })
  })

  it('side by side: parallel repel, antiparallel attract', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    expect(pairInteraction(a, makeDipole('b', 0, 0.4, 1, 0)).kind).toBe('repel')
    expect(pairInteraction(a, makeDipole('b', 0, 0.4, -1, 0)).kind).toBe('attract')
  })

  it('flipping either magnet reverses the force exactly', () => {
    const a = makeDipole('a', 0.1, -0.2, 0.6, 0.8)
    const b = makeDipole('b', 0.7, 0.3, -0.3, 1.1)
    const f = dipoleForce(a, b)
    const fa = dipoleForce(flip(a), b)
    const fb = dipoleForce(a, flip(b))
    expect(rel(fa.x, -f.x)).toBeLessThan(1e-12)
    expect(rel(fb.y, -f.y)).toBeLessThan(1e-12)
    expect(pairInteraction(flip(a), b).kind).not.toBe(pairInteraction(a, b).kind)
  })

  it('obeys Newton’s third law', () => {
    const a = makeDipole('a', 0.1, -0.2, 0.6, 0.8)
    const b = makeDipole('b', 0.7, 0.3, -0.3, 1.1)
    const fab = dipoleForce(a, b)
    const fba = dipoleForce(b, a)
    expect(rel(fab.x, -fba.x)).toBeLessThan(1e-12)
    expect(rel(fab.y, -fba.y)).toBeLessThan(1e-12)
  })

  it('scales with both strengths and falls off as 1/r⁴', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    const b = makeDipole('b', 0.5, 0, 1, 0)
    const base = pairInteraction(a, b).magnitude
    expect(rel(pairInteraction(withStrength(a, 2), withStrength(b, 3)).magnitude, 6 * base)).toBeLessThan(1e-12)
    expect(rel(pairInteraction(a, { ...b, position: vec(1, 0) }).magnitude, base / 16)).toBeLessThan(1e-12)
  })

  it('is the gradient of the energy U = −m_b·B_a, so it matches the drawn field', () => {
    const a = makeDipole('a', -0.1, 0.05, 0.6, 0.8)
    const b = makeDipole('b', 0.45, 0.3, -0.9, 0.4)
    const U = (x: number, y: number) => {
      const B = dipoleField(a, vec(x, y))
      return -(b.moment.x * B.x + b.moment.y * B.y)
    }
    const h = 1e-6
    const fx = -(U(b.position.x + h, b.position.y) - U(b.position.x - h, b.position.y)) / (2 * h)
    const fy = -(U(b.position.x, b.position.y + h) - U(b.position.x, b.position.y - h)) / (2 * h)
    const f = dipoleForce(a, b)
    expect(rel(f.x, fx)).toBeLessThan(1e-5)
    expect(rel(f.y, fy)).toBeLessThan(1e-5)
  })

  it('stays finite when centres coincide or overlap', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    for (const b of [makeDipole('b', 0, 0, 1, 0), makeDipole('b', 0.001, 0, -1, 0)]) {
      const f = dipoleForce(a, b)
      expect(Number.isFinite(f.x) && Number.isFinite(f.y)).toBe(true)
      expect(Number.isFinite(dipoleTorque(a, b))).toBe(true)
    }
  })
})

describe('torque', () => {
  it('turns a magnet towards the local field (τ = m × B)', () => {
    // a's field at b (on a's axis) points +x; b points +y, so it turns clockwise (τ < 0).
    const a = makeDipole('a', 0, 0, 1, 0)
    const b = makeDipole('b', 0.5, 0, 0, 1)
    expect(dipoleTorque(a, b)).toBeLessThan(0)
    // Aligned with the field: no torque.
    expect(Math.abs(dipoleTorque(a, makeDipole('c', 0.5, 0, 1, 0)))).toBeLessThan(1e-20)
  })

  it('net loads superpose over all other magnets', () => {
    const ds = [makeDipole('a', 0, 0, 1, 0), makeDipole('b', 0.5, 0, 1, 0), makeDipole('c', 0, 0.6, 0, 1)]
    const loads = netLoads(ds)
    const fb = dipoleForce(ds[0], ds[1])
    const fc = dipoleForce(ds[2], ds[1])
    expect(rel(loads[1].force.x, fb.x + fc.x)).toBeLessThan(1e-12)
    expect(rel(loads[1].torque, dipoleTorque(ds[0], ds[1]) + dipoleTorque(ds[2], ds[1]))).toBeLessThan(1e-9)
  })
})

describe('interactionLevel', () => {
  it('is a dimensionless 0–1 level, 0.5 at the reference', () => {
    expect(interactionLevel(1e-5, 1e-5)).toBeCloseTo(0.5, 12)
    expect(interactionLevel(0, 1e-5)).toBe(0)
    expect(interactionLevel(Number.NaN, 1e-5)).toBe(0)
    expect(interactionLevel(1, 1e-5)).toBeLessThan(1)
  })
})
