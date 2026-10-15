import { describe, expect, it } from 'vitest'
import { makeDipole, withStrength, type Dipole } from '../physics/dipole'
import { pairInteraction } from '../physics/interaction'
import { scale, vec } from '../physics/vec2'
import { CLEARANCE, overlapDepth, surfaceGap } from './magnetShape'
import { gapFor, initialSimState, pairKey, SIM, step, withoutMagnet, type SimEvent, type SimState } from './simulation'

const bounds = { halfWidth: 2.5, halfHeight: 1.5 }
const run = (state: SimState, seconds: number, frame = 1 / 60) => {
  const events: SimEvent[] = []
  let s = state
  let last = step(s, 0, bounds)
  for (let t = 0; t < seconds; t += frame) {
    last = step(s, frame, bounds)
    s = last.state
    events.push(...last.events)
  }
  return { state: s, events, last }
}
const find = (s: SimState, id: string) => s.dipoles.find((d) => d.id === id)!
const noOverlap = (s: SimState) => s.dipoles.every((d) => overlapDepth(d, s.dipoles, gapFor(s.attached)) < 1e-9)

// Default core radius 0.12 m → bars 0.24 m long; centres 0.26 m apart are 2 cm apart end to end.
describe('opposite poles: attraction and attachment', () => {
  const a = makeDipole('a', -0.21, 0, 1, 0) // N end at x = −0.09
  const b = makeDipole('b', 0.21, 0, 1, 0) // S end at x = +0.09 → N faces S

  it('pull together, snap into contact, and attach once', () => {
    const { state, events } = run(initialSimState([a, b]), 1)
    expect(state.attached).toEqual([pairKey('a', 'b')])
    expect(surfaceGap(find(state, 'a'), find(state, 'b'))).toBeLessThan(SIM.attachedGap + 1e-3)
    const types = events.map((e) => e.type)
    expect(types.filter((t) => t === 'attract')).toHaveLength(1)
    expect(types.filter((t) => t === 'attach')).toHaveLength(1)
    expect(types.indexOf('attract')).toBeLessThan(types.indexOf('attach'))
    const attach = events.find((e) => e.type === 'attach')!
    expect(attach.pairing).toMatchObject({ like: false })
    expect(noOverlap(state)).toBe(true)
  })

  it('stays attached and comes to rest (loop can stop)', () => {
    const first = run(initialSimState([a, b]), 1)
    const later = run(first.state, 1)
    expect(later.state.attached).toEqual([pairKey('a', 'b')])
    expect(later.events).toHaveLength(0)
    expect(later.last.active).toBe(false)
  })

  it('flipping one attached magnet turns attraction into repulsion and separates them', () => {
    const attached = run(initialSimState([a, b]), 1).state
    const flipped: SimState = {
      ...attached,
      dipoles: attached.dipoles.map((d) => (d.id === 'b' ? { ...d, moment: scale(d.moment, -1) } : d)),
    }
    const { state, events } = run(flipped, 1)
    expect(state.attached).toEqual([])
    expect(events.map((e) => e.type)).toContain('detach')
    expect(events.map((e) => e.type)).toContain('repel')
    expect(surfaceGap(find(state, 'a'), find(state, 'b'))).toBeGreaterThan(SIM.releaseGap)
  })
})

describe('like poles: repulsion', () => {
  const a = makeDipole('a', -0.15, 0, 1, 0) // N end at −0.03
  const b = makeDipole('b', 0.15, 0, -1, 0) // N end at +0.03 → N faces N

  it('push apart until friction holds them, without attaching', () => {
    const before = pairInteraction(a, b)
    expect(before.kind).toBe('repel')
    const { state, events } = run(initialSimState([a, b]), 2)
    const da = find(state, 'a')
    const db = find(state, 'b')
    expect(db.position.x - da.position.x).toBeGreaterThan(0.3 + 0.05)
    expect(state.attached).toEqual([])
    expect(events.filter((e) => e.type === 'repel')).toHaveLength(1)
    expect(events.find((e) => e.type === 'repel')!.pairing).toMatchObject({ a: 'N', b: 'N', like: true })
    // Came to rest where the remaining force is at most the static-friction threshold.
    expect(pairInteraction(da, db).magnitude).toBeLessThanOrEqual(SIM.staticForce * 1.05)
  })

  it('a held magnet visibly resists being pushed towards a like pole', () => {
    const s: SimState = { ...initialSimState([a, { ...b, position: vec(0.3, 0) }]), drag: { id: 'a', mode: 'move', target: vec(-0.02, 0) } }
    const r = step(s, 1 / 60, bounds)
    // The pointer asks for x = −0.02; repulsion holds the magnet back (to the left of it).
    expect(find(r.state, 'a').position.x).toBeLessThan(-0.02 - 0.005)
    expect(r.active).toBe(true)
  })

  it('stays inside the bounds when pushed towards an edge', () => {
    const edge = { halfWidth: 0.6, halfHeight: 0.6 }
    let s = initialSimState([a, b])
    for (let i = 0; i < 120; i++) s = step(s, 1 / 60, edge).state
    for (const d of s.dipoles) expect(Math.abs(d.position.x)).toBeLessThanOrEqual(0.6 - d.coreRadius + 1e-9)
  })
})

describe('friction, strength and stability', () => {
  it('distant magnets (the default experiment) do not move and the loop stops', () => {
    const s = initialSimState([makeDipole('m1', -0.6, 0, 1, 0), makeDipole('m2', 0.6, 0, 1, 0)])
    const r = step(s, 1 / 60, bounds)
    expect(r.active).toBe(false)
    expect(r.events).toHaveLength(0)
    expect(r.state.dipoles.map((d) => d.position)).toEqual(s.dipoles.map((d) => d.position))
  })

  it('strength changes the reach: weak magnets stay, strong ones attract from further away', () => {
    const pair = (m: number, gap: number): Dipole[] => [
      withStrength(makeDipole('a', -gap / 2, 0, 1, 0), m),
      withStrength(makeDipole('b', gap / 2, 0, 1, 0), m),
    ]
    expect(run(initialSimState(pair(0.3, 0.42)), 0.5).state.attached).toEqual([])
    expect(run(initialSimState(pair(3, 0.6)), 1.5).state.attached).toEqual([pairKey('a', 'b')])
  })

  it('does not re-trigger events every frame (hysteresis)', () => {
    const a = makeDipole('a', -0.15, 0, 1, 0)
    const b = makeDipole('b', 0.15, 0, -1, 0)
    const { events } = run(initialSimState([a, b]), 3, 1 / 120)
    expect(events.filter((e) => e.type === 'repel')).toHaveLength(1)
  })

  it('the first zero-length step after a change keeps the loop alive when a magnet will move', () => {
    // A requestAnimationFrame loop starts with dt = 0; it must not stop before forces can act.
    const near = initialSimState([makeDipole('a', -0.21, 0, 1, 0), makeDipole('b', 0.21, 0, 1, 0)])
    expect(step(near, 0, bounds).active).toBe(true)
    const far = initialSimState([makeDipole('a', -0.6, 0, 1, 0), makeDipole('b', 0.6, 0, 1, 0)])
    expect(step(far, 0, bounds).active).toBe(false)
  })

  it('a pair pressed together in contact does not keep the loop running', () => {
    const attached = run(initialSimState([makeDipole('a', -0.21, 0, 1, 0), makeDipole('b', 0.21, 0, 1, 0)]), 1).state
    expect(step(attached, 1 / 60, bounds).active).toBe(false)
  })

    it('ignores invalid frame times', () => {
    const s = initialSimState([makeDipole('a', -0.21, 0, 1, 0), makeDipole('b', 0.21, 0, 1, 0)])
    for (const dt of [Number.NaN, -1, Infinity]) {
      const r = step(s, dt, bounds)
      for (const d of r.state.dipoles) expect(Number.isFinite(d.position.x) && Number.isFinite(d.position.y)).toBe(true)
    }
  })
})

describe('dragging attached magnets', () => {
  const attachedState = () =>
    run(initialSimState([makeDipole('a', -0.21, 0, 1, 0), makeDipole('b', 0.21, 0, 1, 0)]), 1).state

  it('holds on until pulled past the breakaway distance, then separates', () => {
    const s = attachedState()
    const bx = find(s, 'b').position.x
    const gentle = step({ ...s, drag: { id: 'b', mode: 'move', target: vec(bx + SIM.breakaway / 2, 0) } }, 1 / 60, bounds)
    expect(gentle.holding).toBe(true)
    expect(find(gentle.state, 'b').position.x).toBeCloseTo(bx, 9)
    expect(gentle.state.attached).toHaveLength(1)

    const hard = run({ ...s, drag: { id: 'b', mode: 'move', target: vec(bx + 0.6, 0) } }, 0.2)
    expect(hard.state.attached).toEqual([])
    expect(hard.events.map((e) => e.type)).toContain('detach')
    expect(find(hard.state, 'b').position.x).toBeGreaterThan(bx + 0.4)
  })

  it('removing an attached magnet clears its attachment', () => {
    const s = withoutMagnet(attachedState(), 'b')
    expect(s.dipoles.map((d) => d.id)).toEqual(['a'])
    expect(s.attached).toEqual([])
    expect(Object.keys(s.phases)).toEqual([])
  })

  it('a dragged magnet is pulled into contact by an opposite pole and attaches', () => {
    const a = makeDipole('a', 0, 0, 1, 0)
    const b = makeDipole('b', 0.8, 0, 1, 0)
    // Bring b's S end towards a's N end in pointer steps.
    let s: SimState = initialSimState([a, b])
    const events: SimEvent[] = []
    for (let x = 0.8; x >= 0.25; x -= 0.01) {
      const r = step({ ...s, drag: { id: 'b', mode: 'move', target: vec(x, 0) } }, 1 / 60, bounds)
      s = r.state
      events.push(...r.events)
    }
    expect(events.map((e) => e.type)).toContain('attach')
    expect(s.attached).toEqual([pairKey('a', 'b')])
    expect(surfaceGap(find(s, 'a'), find(s, 'b'))).toBeLessThan(CLEARANCE)
    expect(noOverlap(s)).toBe(true)
  })
})
