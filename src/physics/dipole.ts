import { add, dot, scale, sub, vec, ZERO, type Vec2 } from './vec2'

/** μ0 / 4π in SI units (T·m/A). */
export const MU0_OVER_4PI = 1e-7

/**
 * A point magnetic dipole lying in the simulation plane.
 * The 2D view is the z = 0 slice of the full 3D dipole field, so the
 * field formula is the physical 3D one evaluated in the plane.
 */
export interface Dipole {
  readonly id: string
  /** Centre position (m). */
  readonly position: Vec2
  /** Magnetic moment vector (A·m²). Points from S to N. */
  readonly moment: Vec2
  /** Radius of the solid magnet body (m). Field lines terminate inside it. */
  readonly coreRadius: number
}

/**
 * Field of one dipole at point p (tesla):
 *   B = (μ0/4π) · (3 (m·r) r / r⁵ − m / r³)
 *
 * `softening` (m) replaces r² with r² + ε² so the field stays finite at the
 * centre. It changes the field by O(ε²/r²), so keep ε well inside the core.
 */
export function dipoleField(d: Dipole, p: Vec2, softening = 0): Vec2 {
  const r = sub(p, d.position)
  const r2 = dot(r, r) + softening * softening
  if (r2 === 0) return ZERO
  const inv = 1 / Math.sqrt(r2)
  const inv3 = inv * inv * inv
  const inv5 = inv3 * inv * inv
  const mr = dot(d.moment, r)
  return scale(sub(scale(r, 3 * mr * inv5), scale(d.moment, inv3)), MU0_OVER_4PI)
}

/** Superposition: the total field is the vector sum of every dipole's field. */
export function totalField(dipoles: readonly Dipole[], p: Vec2, softening = 0): Vec2 {
  let b = ZERO
  for (const d of dipoles) b = add(b, dipoleField(d, p, softening))
  return b
}

/**
 * ∂Bz/∂z at z = 0 for dipoles in the plane. Needed only to check ∇·B = 0,
 * because the in-plane slice alone is not divergence-free.
 */
export function dBzdz(dipoles: readonly Dipole[], p: Vec2): number {
  let s = 0
  for (const d of dipoles) {
    const r = sub(p, d.position)
    const r2 = dot(r, r)
    s += (3 * dot(d.moment, r)) / (r2 * r2 * Math.sqrt(r2))
  }
  return MU0_OVER_4PI * s
}

/** Index of the dipole whose core contains p, or -1. */
export function coreHit(dipoles: readonly Dipole[], p: Vec2): number {
  for (let i = 0; i < dipoles.length; i++) {
    const d = dipoles[i]
    const dx = p.x - d.position.x
    const dy = p.y - d.position.y
    if (dx * dx + dy * dy < d.coreRadius * d.coreRadius) return i
  }
  return -1
}

/**
 * Magnet strength is the dipole moment magnitude |m| in A·m². These are model
 * values for exploring the field shape, not calibrated measurements of any
 * real magnet. The minimum is above zero so every magnet keeps a direction.
 */
export const STRENGTH = { min: 0.1, max: 5, step: 0.1, default: 1 } as const

export const strengthOf = (d: Dipole): number => Math.hypot(d.moment.x, d.moment.y)

/** Unit vector along the moment (S → N); +x for a zero or invalid moment. */
export const axisOf = (d: Dipole): Vec2 => {
  const m = strengthOf(d)
  return m > 0 && Number.isFinite(m) ? vec(d.moment.x / m, d.moment.y / m) : vec(1, 0)
}

/** Returns a copy with |m| set to `strength` (clamped to STRENGTH), keeping its direction. */
export function withStrength(d: Dipole, strength: number): Dipole {
  const s = Number.isFinite(strength) ? Math.min(STRENGTH.max, Math.max(STRENGTH.min, strength)) : STRENGTH.default
  return { ...d, moment: scale(axisOf(d), s) }
}

export const makeDipole = (id: string, x: number, y: number, mx: number, my: number, coreRadius = 0.12): Dipole => ({
  id,
  position: vec(x, y),
  moment: vec(mx, my),
  coreRadius,
})
