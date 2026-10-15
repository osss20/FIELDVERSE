import { SoundGate, type SoundKind } from './soundGate'

/**
 * Small Web Audio synthesiser for interaction sounds. Every sound is
 * generated from oscillators and a short noise buffer, so there are no audio
 * files and no external services.
 *
 * Browsers only allow audio after a user gesture, so the AudioContext is
 * created in `unlock()`, which callers invoke from a pointer or click handler.
 * Before that, `play()` does nothing.
 */
export interface AudioLike {
  readonly currentTime: number
  readonly state: string
  readonly sampleRate: number
  readonly destination: AudioNode
  resume(): Promise<void>
  close(): Promise<void>
  createOscillator(): OscillatorNode
  createGain(): GainNode
  createBiquadFilter(): BiquadFilterNode
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer
  createBufferSource(): AudioBufferSourceNode
}

export type ContextFactory = () => AudioLike | null

const defaultFactory: ContextFactory = () => {
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  return Ctor ? new Ctor() : null
}

export class SoundEngine {
  private ctx: AudioLike | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  private gate = new SoundGate()
  enabled = true

  private readonly factory: ContextFactory
  private readonly now: () => number

  constructor(factory: ContextFactory = defaultFactory, now: () => number = () => performance.now()) {
    this.factory = factory
    this.now = now
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = this.factory()
      } catch {
        this.ctx = null
      }
      if (!this.ctx) return
      this.master = this.ctx.createGain()
      this.master.gain.value = 0.6
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
  }

  get unlocked() {
    return this.ctx !== null
  }

  /**
   * Plays `kind` unless sound is off, audio is not unlocked yet, or the
   * cooldown for this kind or this `key` (e.g. a magnet pair) is active.
   * Returns whether it played.
   */
  play(kind: SoundKind, key = ''): boolean {
    if (!this.enabled || !this.ctx || !this.master) return false
    if (!this.gate.allow(kind, key, this.now())) return false
    try {
      VOICES[kind](this.ctx, this.master, this.noiseBuffer())
      return true
    } catch {
      return false
    }
  }

  /** Releases the AudioContext. The engine can be unlocked again later. */
  dispose() {
    const ctx = this.ctx
    this.ctx = null
    this.master = null
    this.noise = null
    this.gate.reset()
    if (ctx) void ctx.close().catch(() => {})
  }

  private noiseBuffer(): AudioBuffer {
    if (!this.noise) {
      const ctx = this.ctx!
      const len = Math.floor(ctx.sampleRate * 0.25)
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    }
    return this.noise
  }
}

type Voice = (ctx: AudioLike, out: AudioNode, noise: AudioBuffer) => void

/** Gain envelope: quick attack, exponential decay to silence. */
function envelope(ctx: AudioLike, out: AudioNode, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain()
  const t = ctx.currentTime
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
  g.connect(out)
  return g
}

function tone(
  ctx: AudioLike,
  out: AudioNode,
  type: OscillatorType,
  from: number,
  to: number,
  peak: number,
  attack: number,
  decay: number,
) {
  const osc = ctx.createOscillator()
  const t = ctx.currentTime
  osc.type = type
  osc.frequency.setValueAtTime(from, t)
  osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay)
  osc.connect(envelope(ctx, out, peak, attack, decay))
  osc.onended = () => osc.disconnect()
  osc.start(t)
  osc.stop(t + attack + decay + 0.02)
}

function noiseBurst(ctx: AudioLike, out: AudioNode, noise: AudioBuffer, filter: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number) {
  const src = ctx.createBufferSource()
  src.buffer = noise
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  f.Q.value = q
  src.connect(f)
  f.connect(envelope(ctx, out, peak, attack, decay))
  src.onended = () => {
    src.disconnect()
    f.disconnect()
  }
  const t = ctx.currentTime
  src.start(t)
  src.stop(t + attack + decay + 0.02)
}

const VOICES: Record<SoundKind, Voice> = {
  // Soft low push: a falling sine with a brief band-passed whoosh.
  repel: (ctx, out, noise) => {
    tone(ctx, out, 'sine', 170, 75, 0.35, 0.012, 0.22)
    noiseBurst(ctx, out, noise, 'bandpass', 380, 0.9, 0.12, 0.01, 0.16)
  },
  // Gentle rising pull.
  attract: (ctx, out) => {
    tone(ctx, out, 'triangle', 240, 480, 0.12, 0.05, 0.22)
  },
  // Crisp snap: a short high click over a small low thump.
  attach: (ctx, out, noise) => {
    noiseBurst(ctx, out, noise, 'highpass', 2600, 0.7, 0.35, 0.002, 0.035)
    tone(ctx, out, 'sine', 1400, 900, 0.12, 0.002, 0.06)
    tone(ctx, out, 'sine', 140, 90, 0.3, 0.004, 0.07)
  },
  // Light release.
  detach: (ctx, out) => {
    tone(ctx, out, 'sine', 520, 300, 0.08, 0.005, 0.09)
  },
  add: (ctx, out) => {
    tone(ctx, out, 'sine', 620, 760, 0.07, 0.005, 0.07)
  },
  remove: (ctx, out) => {
    tone(ctx, out, 'sine', 460, 330, 0.07, 0.005, 0.08)
  },
}
