import { axisOf, type Dipole } from '../physics/dipole'
import { add, dot, fromAngle, isFiniteVec, length, scale, sub, vec, type Vec2 } from '../physics/vec2'

/**
 * Rendered magnet body: a bar centred on the dipole, aligned with the moment.
 * The bar fits inside the core circle, so field lines end at the body.
 */
export const BODY_HALF_LENGTH = 1 // × coreRadius
export const BODY_HALF_WIDTH = 0.4 // × coreRadius
/** Minimum gap kept between magnet bodies (m). */
export const CLEARANCE = 0.02

export const bodyHalfLength = (d: Dipole) => d.coreRadius * BODY_HALF_LENGTH
export const bodyHalfWidth = (d: Dipole) => d.coreRadius * BODY_HALF_WIDTH

/** True if world point p lies on the magnet body, widened by `pad` (m). */
export function hitsBody(d: Dipole, p: Vec2, pad = 0): boolean {
  const u = axisOf(d)
  const r = sub(p, d.position)
  return Math.abs(dot(r, u)) <= bodyHalfLength(d) + pad && Math.abs(r.x * -u.y + r.y * u.x) <= bodyHalfWidth(d) + pad
}

/**
 * Penetration depth between two bodies, each inflated by half the clearance
 * (separating-axis test on two oriented rectangles). 0 means they are at
 * least CLEARANCE apart; larger values mean deeper overlap.
 */
export function penetration(a: Dipole, b: Dipole, clearance = CLEARANCE): number {
  const ua = axisOf(a)
  const ub = axisOf(b)
  const axes = [ua, vec(-ua.y, ua.x), ub, vec(-ub.y, ub.x)]
  const d = sub(b.position, a.position)
  const pad = clearance / 2
  let min = Infinity
  for (const ax of axes) {
    const ra =
      (bodyHalfLength(a) + pad) * Math.abs(dot(ua, ax)) + (bodyHalfWidth(a) + pad) * Math.abs(dot(vec(-ua.y, ua.x), ax))
    const rb =
      (bodyHalfLength(b) + pad) * Math.abs(dot(ub, ax)) + (bodyHalfWidth(b) + pad) * Math.abs(dot(vec(-ub.y, ub.x), ax))
    const overlap = ra + rb - Math.abs(dot(d, ax))
    if (overlap <= 0) return 0
    min = Math.min(min, overlap)
  }
  return min
}

/** Required gap (m) between two specific magnets; CLEARANCE unless a caller relaxes it. */
export type GapFn = (a: Dipole, b: Dipole) => number
const defaultGap: GapFn = () => CLEARANCE

/** Sum of penetration depths between `d` and every other magnet. */
export function overlapDepth(d: Dipole, others: readonly Dipole[], gap: GapFn = defaultGap): number {
  let s = 0
  for (const o of others) if (o.id !== d.id) s += penetration(d, o, gap(d, o))
  return s
}

/**
 * Approximate surface gap between two bodies (m): the largest clearance at
 * which they do not overlap. 0 when touching or overlapping.
 */
export function surfaceGap(a: Dipole, b: Dipole): number {
  if (penetration(a, b, 0) > 0) return 0
  let lo = 0
  let hi = Math.max(1e-6, Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y))
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (penetration(a, b, mid) > 0) hi = mid
    else lo = mid
  }
  return lo
}

export interface Constrained<T> {
  value: T
  /** True when the requested change was limited to avoid an overlap. */
  blocked: boolean
}

const EPS = 1e-9

/**
 * A pose is allowed if it is clear of every other magnet, or no deeper in
 * overlap than the magnet already is. The second rule means a magnet that
 * somehow starts overlapping can always be pulled apart and never gets stuck.
 */
const allowed = (candidate: Dipole, current: Dipole, others: readonly Dipole[], gap: GapFn) => {
  const depth = overlapDepth(candidate, others, gap)
  if (depth <= EPS) return true
  // No tolerance here: repeated small steps must never ratchet an overlap deeper.
  const now = overlapDepth(current, others, gap)
  return now > EPS && depth <= now
}

/** Largest t in [0, 1] with pose(t) allowed, assuming pose(0) is allowed. */
function furthestAllowed(pose: (t: number) => Dipole, current: Dipole, others: readonly Dipole[], gap: GapFn): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (allowed(pose(mid), current, others, gap)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Moves magnet `id` towards `target`. If the target would overlap, it keeps
 * the allowed pose closest to the target: sliding along x or y, or stopping
 * at contact. This keeps dragging smooth along another magnet's edge.
 */
export function constrainMove(
  dipoles: readonly Dipole[],
  id: string,
  target: Vec2,
  gap: GapFn = defaultGap,
): Constrained<Vec2> {
  const current = dipoles.find((d) => d.id === id)
  if (!current) return { value: target, blocked: false }
  if (!isFiniteVec(target)) return { value: current.position, blocked: true }
  const at = (p: Vec2): Dipole => ({ ...current, position: p })
  if (allowed(at(target), current, dipoles, gap)) return { value: target, blocked: false }

  const from = current.position
  const toward = (t: number) => at(add(from, scale(sub(target, from), t)))
  const contact = add(from, scale(sub(target, from), furthestAllowed(toward, current, dipoles, gap)))
  // Slide from the start or from the contact point along whichever axis is free.
  const candidates = [
    vec(target.x, from.y),
    vec(from.x, target.y),
    contact,
    vec(target.x, contact.y),
    vec(contact.x, target.y),
  ].filter((p) => allowed(at(p), current, dipoles, gap))
  let best = from
  for (const p of candidates) if (length(sub(p, target)) < length(sub(best, target))) best = p
  return { value: best, blocked: true }
}

/**
 * Rotates magnet `id` to `angle` (radians from +x), keeping its strength.
 * If that would overlap, it turns as far as possible along the shorter arc.
 */
export function constrainRotate(
  dipoles: readonly Dipole[],
  id: string,
  angle: number,
  gap: GapFn = defaultGap,
): Constrained<Vec2> {
  const current = dipoles.find((d) => d.id === id)
  if (!current) return { value: fromAngle(angle), blocked: false }
  const m = length(current.moment)
  if (!Number.isFinite(angle)) return { value: current.moment, blocked: true }
  const at = (a: number): Dipole => ({ ...current, moment: fromAngle(a, m) })
  if (allowed(at(angle), current, dipoles, gap)) return { value: at(angle).moment, blocked: false }
  const start = Math.atan2(current.moment.y, current.moment.x)
  // Shortest signed difference in (−π, π].
  const delta = Math.atan2(Math.sin(angle - start), Math.cos(angle - start))
  const t = furthestAllowed((s) => at(start + s * delta), current, dipoles, gap)
  return { value: at(start + t * delta).moment, blocked: true }
}

/**
 * Nearest position to `preferred` where `candidate` is clear of every magnet,
 * searched in rings; null if nothing fits inside `limit` (half-extents, m).
 */
export function findFreeSpot(
  dipoles: readonly Dipole[],
  candidate: Dipole,
  preferred: Vec2,
  limit: Vec2,
): Vec2 | null {
  const fits = (p: Vec2) =>
    Math.abs(p.x) <= limit.x && Math.abs(p.y) <= limit.y && overlapDepth({ ...candidate, position: p }, dipoles) <= EPS
  if (fits(preferred)) return preferred
  const ring = 0.1
  for (let r = ring; r <= Math.hypot(limit.x, limit.y) * 2; r += ring) {
    const n = Math.max(8, Math.ceil((2 * Math.PI * r) / ring))
    for (let k = 0; k < n; k++) {
      const p = add(preferred, fromAngle((k / n) * 2 * Math.PI, r))
      if (fits(p)) return p
    }
  }
  return null
}
