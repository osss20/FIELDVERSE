import { describe, expect, it } from 'vitest'
import { SoundEngine, type AudioLike } from './soundEngine'
import { COOLDOWN_MS, SoundGate } from './soundGate'

describe('SoundGate cooldowns', () => {
  it('blocks the same kind until its cooldown passes', () => {
    const g = new SoundGate()
    expect(g.allow('attach', 'a|b', 0)).toBe(true)
    expect(g.allow('attach', 'c|d', 10)).toBe(false) // kind cooldown
    expect(g.allow('attach', 'c|d', COOLDOWN_MS.attach.kind + 1)).toBe(true)
  })

  it('blocks repeats for the same pair longer than for other pairs', () => {
    const g = new SoundGate()
    expect(g.allow('repel', 'a|b', 0)).toBe(true)
    expect(g.allow('repel', 'a|b', COOLDOWN_MS.repel.kind + 1)).toBe(false) // same pair still cooling
    expect(g.allow('repel', 'c|d', COOLDOWN_MS.repel.kind + 1)).toBe(true)
    expect(g.allow('repel', 'a|b', COOLDOWN_MS.repel.key + 1)).toBe(true)
  })

  it('kinds are independent', () => {
    const g = new SoundGate()
    expect(g.allow('attract', 'a|b', 0)).toBe(true)
    expect(g.allow('attach', 'a|b', 1)).toBe(true)
  })

  it('a continuous drag that re-crosses the threshold every frame plays once per cooldown', () => {
    const g = new SoundGate()
    let played = 0
    for (let t = 0; t < 2000; t += 16) if (g.allow('repel', 'a|b', t)) played++
    // Plays at t = 0, then at the first frame at least one pair cooldown later (912 ms, 1824 ms).
    expect(COOLDOWN_MS.repel.key).toBe(900)
    expect(played).toBe(3)
  })
})

/** Minimal fake AudioContext that records what was scheduled. */
function fakeContext() {
  const log: string[] = []
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const node = (name: string) => ({
    connect() {},
    disconnect() {},
    start() {
      log.push(`start:${name}`)
    },
    stop() {},
    onended: null as null | (() => void),
    frequency: param(),
    gain: param(),
    Q: param(),
    type: '',
    buffer: null as unknown,
  })
  let closed = false
  const ctx = {
    currentTime: 0,
    state: 'suspended',
    sampleRate: 8000,
    destination: node('dest'),
    resume: async () => {
      ctx.state = 'running'
    },
    close: async () => {
      closed = true
    },
    createOscillator: () => node('osc'),
    createGain: () => node('gain'),
    createBiquadFilter: () => node('filter'),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createBufferSource: () => node('noise'),
  }
  return { ctx: ctx as unknown as AudioLike, log, isClosed: () => closed }
}

describe('SoundEngine', () => {
  it('stays silent until unlocked by a user gesture', () => {
    const f = fakeContext()
    let created = 0
    const e = new SoundEngine(() => (created++, f.ctx), () => 0)
    expect(e.play('attach', 'a|b')).toBe(false)
    expect(created).toBe(0) // no AudioContext before the gesture
    e.unlock()
    expect(created).toBe(1)
    expect(e.play('attach', 'a|b')).toBe(true)
    expect(f.log.some((l) => l.startsWith('start:'))).toBe(true)
  })

  it('respects the on/off toggle', () => {
    const f = fakeContext()
    const e = new SoundEngine(() => f.ctx, () => 0)
    e.unlock()
    e.enabled = false
    expect(e.play('repel', 'a|b')).toBe(false)
    e.enabled = true
    expect(e.play('repel', 'a|b')).toBe(true)
  })

  it('applies cooldowns through the gate', () => {
    let now = 0
    const f = fakeContext()
    const e = new SoundEngine(() => f.ctx, () => now)
    e.unlock()
    expect(e.play('repel', 'a|b')).toBe(true)
    now = 50
    expect(e.play('repel', 'a|b')).toBe(false)
    now = COOLDOWN_MS.repel.key + 1
    expect(e.play('repel', 'a|b')).toBe(true)
  })

  it('creates one context, resumes it, and closes it on dispose', async () => {
    const f = fakeContext()
    let created = 0
    const e = new SoundEngine(() => (created++, f.ctx), () => 0)
    e.unlock()
    e.unlock()
    expect(created).toBe(1)
    await Promise.resolve()
    expect(f.ctx.state).toBe('running')
    e.dispose()
    expect(f.isClosed()).toBe(true)
    expect(e.play('add')).toBe(false)
  })

  it('degrades quietly when Web Audio is unavailable', () => {
    const e = new SoundEngine(() => null, () => 0)
    e.unlock()
    expect(e.unlocked).toBe(false)
    expect(e.play('attach')).toBe(false)
    const throwing = new SoundEngine(() => {
      throw new Error('no audio')
    })
    expect(() => throwing.unlock()).not.toThrow()
  })
})
