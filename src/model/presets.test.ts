import { describe, expect, it } from 'vitest'
import { makeDipole } from '../physics/dipole'
import { computeFieldLines, DEFAULT_LINE_SET, lineIntensities } from '../physics/fieldLines'
import { vec } from '../physics/vec2'
import { eventMessage, formatGap, strongestInteraction } from './feedback'
import { overlapDepth } from './magnetShape'
import { FREE_EXPERIMENT, presetById, PRESETS } from './presets'
import { initialSimState, pairKey, step, type SimEvent, type SimState } from './simulation'

const bounds = { halfWidth: 1.6, halfHeight: 1.5 }
const run = (s: SimState, seconds: number) => {
  // The zero-length first step evaluates the starting layout; its events count too.
  let last = step(s, 0, bounds)
  const events: SimEvent[] = [...last.events]
  for (let t = 0; t < seconds; t += 1 / 60) {
    last = step(last.state, 1 / 60, bounds)
    events.push(...last.events)
  }
  return { state: last.state, events, active: last.active }
}

describe('presets', () => {
  it('build valid, non-overlapping layouts with unique ids inside a phone-width view', () => {
    for (const p of PRESETS) {
      const ds = p.build()
      expect(new Set(ds.map((d) => d.id)).size).toBe(ds.length)
      for (const d of ds) {
        expect(overlapDepth(d, ds)).toBe(0)
        expect(Math.abs(d.position.x) + d.coreRadius).toBeLessThanOrEqual(bounds.halfWidth)
        expect(Math.abs(d.position.y) + d.coreRadius).toBeLessThanOrEqual(bounds.halfHeight)
      }
      expect(p.principle.length).toBeGreaterThan(20)
    }
    expect(PRESETS.length).toBeGreaterThanOrEqual(6) // free + the five experiments
  })

  it('build fresh copies, so reset is independent of earlier changes', () => {
    const a = FREE_EXPERIMENT.build()
    const b = FREE_EXPERIMENT.build()
    expect(a).toEqual(b)
    expect(a[0]).not.toBe(b[0])
  })

  it('like-pole preset repels and the opposite-pole preset attaches', () => {
    const like = run(initialSimState(presetById('like-repel').build()), 2)
    expect(like.events.map((e) => e.type)).toContain('repel')
    expect(like.state.attached).toEqual([])
    const opp = run(initialSimState(presetById('opposite-attract').build()), 1.5)
    expect(opp.events.map((e) => e.type)).toEqual(expect.arrayContaining(['attract', 'attach']))
    expect(opp.state.attached).toEqual([pairKey('m1', 'm2')])
  })

  it('the study presets start at rest', () => {
    for (const id of ['free', 'aligned', 'orientations', 'multiple']) {
      const s = initialSimState(presetById(id).build())
      const r = step(s, 1 / 60, bounds)
      expect(r.active, id).toBe(false)
      expect(r.events, id).toHaveLength(0)
    }
  })

  it('unknown ids fall back to the free experiment', () => {
    expect(presetById('nope')).toBe(FREE_EXPERIMENT)
  })
})

describe('feedback', () => {
  const pairing = (like: boolean) => ({ a: 'N' as const, b: like ? ('N' as const) : ('S' as const), like, pointA: vec(0, 0), pointB: vec(0, 0), distance: 0 })
  const ev = (type: SimEvent['type'], like: boolean): SimEvent => ({ type, a: 'm1', b: 'm2', pairing: pairing(like), at: vec(0, 0) })

  it('describes events in terms that match the pole pairing', () => {
    expect(eventMessage(ev('repel', true))).toBe('Like poles repel.')
    expect(eventMessage(ev('attract', false))).toBe('Opposite poles attract.')
    expect(eventMessage(ev('attach', false))).toBe('Magnetic connection established.')
    expect(eventMessage(ev('detach', false))).toBe('Magnets separated.')
    // Geometry that contradicts the simple rule gets a careful wording instead.
    expect(eventMessage(ev('attract', true))).toMatch(/net dipole force/)
    expect(eventMessage(ev('repel', false))).toMatch(/net dipole force/)
  })

  it('reports the strongest partner, pole pairing, gap and a relative level', () => {
    const ds = [makeDipole('a', 0, 0, 1, 0), makeDipole('b', 0.3, 0, 1, 0), makeDipole('c', 0, 1.2, 1, 0)]
    const r = strongestInteraction(ds, 'a', [])!
    expect(r.partnerId).toBe('b')
    expect(r.kind).toBe('attract')
    expect(r.pairing).toMatchObject({ a: 'N', b: 'S', like: false })
    expect(r.gap).toBeCloseTo(0.06, 3) // 0.3 − 2 × 0.12
    expect(r.level).toBeGreaterThan(0.5)
    expect(r.level).toBeLessThan(1)
    expect(r.active).toBe(true)
    expect(strongestInteraction([ds[0]], 'a', [])).toBeNull()
  })

  it('formats gaps in centimetres', () => {
    expect(formatGap(0.034)).toBe('3.4 cm')
    expect(formatGap(0.5)).toBe('50 cm')
  })
})

describe('field strength shading', () => {
  it('is 0–1 and higher near the magnets than far away', () => {
    const ds = [makeDipole('a', 0, 0, 1, 0)]
    const lines = computeFieldLines(ds, { ...DEFAULT_LINE_SET, bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 } })
    const shades = lineIntensities(lines, ds, DEFAULT_LINE_SET.softening)
    expect(shades).toHaveLength(lines.length)
    let near = 0
    let far = 0
    lines.forEach((l, i) =>
      l.points.forEach((p, j) => {
        const t = shades[i][j]
        expect(t).toBeGreaterThanOrEqual(0)
        expect(t).toBeLessThanOrEqual(1)
        const r = Math.hypot(p.x, p.y)
        if (r < 0.2) near = Math.max(near, t)
        if (r > 1.2) far = Math.max(far, t)
      }),
    )
    expect(near).toBeGreaterThan(far)
  })
})
