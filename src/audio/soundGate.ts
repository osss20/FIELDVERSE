export type SoundKind = 'repel' | 'attract' | 'attach' | 'detach' | 'add' | 'remove'

/** Minimum time between two sounds of the same kind, and between repeats for the same magnet pair (ms). */
export const COOLDOWN_MS: Record<SoundKind, { kind: number; key: number }> = {
  repel: { kind: 250, key: 900 },
  attract: { kind: 250, key: 900 },
  attach: { kind: 120, key: 500 },
  detach: { kind: 200, key: 500 },
  add: { kind: 80, key: 80 },
  remove: { kind: 80, key: 80 },
}

/**
 * Decides whether a sound may play now. Pure apart from its own memory, with
 * the clock passed in, so it is deterministic in tests. A sound is refused
 * while its kind is cooling down (prevents stacking) or while the same kind
 * for the same `key` (e.g. a magnet pair) is cooling down (prevents repeats
 * during continuous dragging).
 */
export class SoundGate {
  private lastKind = new Map<SoundKind, number>()
  private lastKey = new Map<string, number>()

  allow(kind: SoundKind, key: string, now: number): boolean {
    const c = COOLDOWN_MS[kind]
    const k = this.lastKind.get(kind)
    const kk = this.lastKey.get(`${kind}:${key}`)
    if (k !== undefined && now - k < c.kind) return false
    if (kk !== undefined && now - kk < c.key) return false
    this.lastKind.set(kind, now)
    this.lastKey.set(`${kind}:${key}`, now)
    return true
  }

  reset() {
    this.lastKind.clear()
    this.lastKey.clear()
  }
}
