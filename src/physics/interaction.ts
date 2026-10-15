import { axisOf, dipoleField, MU0_OVER_4PI, type Dipole } from './dipole'
import { add, distance, dot, length, scale, sub, vec, ZERO, type Vec2 } from './vec2'

/**
 * Magnet-to-magnet interaction in the point-dipole model.
 *
 * Force on dipole b from dipole a, with r = b − a, r̂ = r/|r| (SI units):
 *   F = 3(μ0/4π)/r⁴ · [ (mₐ·r̂) m_b + (m_b·r̂) mₐ + (mₐ·m_b) r̂ − 5 (mₐ·r̂)(m_b·r̂) r̂ ]
 * Torque on b (z component, moments in the plane):  τ = m_b × B_a(r_b).
 *
 * Both follow from the energy U = −m_b·B_a(r_b) of the same dipole field that
 * is drawn as field lines, so forces and the picture always agree. Limits:
 * real bar magnets are not point dipoles, so near contact the real force
 * differs (the model is a smooth idealisation, not a measurement), and
 * strengths are model values, so forces are model quantities too.
 */

/** Centre distances below this are treated as this, so overlapping magnets never produce Infinity. */
export const MIN_INTERACTION_DISTANCE = 0.05

export function dipoleForce(a: Dipole, b: Dipole): Vec2 {
  const r = sub(b.position, a.position)
  const dist = Math.max(MIN_INTERACTION_DISTANCE, length(r))
  if (!Number.isFinite(dist)) return ZERO
  const rh = length(r) > 0 ? scale(r, 1 / length(r)) : vec(1, 0)
  const ma = a.moment
  const mb = b.moment
  const mar = dot(ma, rh)
  const mbr = dot(mb, rh)
  const c = (3 * MU0_OVER_4PI) / dist ** 4
  const f = add(add(scale(mb, mar), scale(ma, mbr)), scale(rh, dot(ma, mb) - 5 * mar * mbr))
  const out = scale(f, c)
  return Number.isFinite(out.x) && Number.isFinite(out.y) ? out : ZERO
}

/** z-torque on b from a's field: positive turns b's moment counter-clockwise. */
export function dipoleTorque(a: Dipole, b: Dipole): number {
  // Softening keeps the field finite if centres coincide; it is negligible at
  // real separations (centres are at least a bar width apart).
  const B = dipoleField(a, b.position, TORQUE_SOFTENING)
  const t = b.moment.x * B.y - b.moment.y * B.x
  return Number.isFinite(t) ? t : 0
}

const TORQUE_SOFTENING = 0.01

export type InteractionKind = 'attract' | 'repel'

export interface PairInteraction {
  /** Force on b (on a it is the negative, by Newton's third law). */
  force: Vec2
  magnitude: number
  /** Component of the force on b along a→b: positive pushes apart, negative pulls together. */
  radial: number
  kind: InteractionKind
}

export function pairInteraction(a: Dipole, b: Dipole): PairInteraction {
  const force = dipoleForce(a, b)
  const r = sub(b.position, a.position)
  const rl = length(r)
  const radial = rl > 0 ? dot(force, r) / rl : 0
  return { force, magnitude: length(force), radial, kind: radial < 0 ? 'attract' : 'repel' }
}

export interface NetLoad {
  force: Vec2
  torque: number
}

/** Net force and torque on every magnet from all the others (superposition). */
export function netLoads(dipoles: readonly Dipole[]): NetLoad[] {
  return dipoles.map((b) => {
    let force = ZERO
    let torque = 0
    for (const a of dipoles) {
      if (a.id === b.id) continue
      force = add(force, dipoleForce(a, b))
      torque += dipoleTorque(a, b)
    }
    return { force, torque }
  })
}

export type Pole = 'N' | 'S'

export interface PolePairing {
  a: Pole
  b: Pole
  /** True for N–N or S–S. */
  like: boolean
  /** Positions of the two facing poles (m). */
  pointA: Vec2
  pointB: Vec2
  /** Distance between the facing poles (m). */
  distance: number
}

/** Pole positions: the ends of the bar, N in the direction of the moment. */
export function polePositions(d: Dipole, halfLength: number): Record<Pole, Vec2> {
  const u = axisOf(d)
  return { N: add(d.position, scale(u, halfLength)), S: sub(d.position, scale(u, halfLength)) }
}

/** The pair of poles (one per magnet) that face each other most closely. */
export function polePairing(a: Dipole, b: Dipole, halfLengthA: number, halfLengthB: number): PolePairing {
  const pa = polePositions(a, halfLengthA)
  const pb = polePositions(b, halfLengthB)
  let best: PolePairing | null = null
  for (const ka of ['N', 'S'] as const) {
    for (const kb of ['N', 'S'] as const) {
      const dist = distance(pa[ka], pb[kb])
      if (!best || dist < best.distance) {
        best = { a: ka, b: kb, like: ka === kb, pointA: pa[ka], pointB: pb[kb], distance: dist }
      }
    }
  }
  return best!
}

/**
 * Maps a force magnitude to a 0–1 display level, 0.5 at `reference`.
 * Dimensionless and relative: for meters and bars, never a value in newtons.
 */
export const interactionLevel = (magnitude: number, reference: number): number =>
  Number.isFinite(magnitude) && magnitude > 0 && reference > 0 ? magnitude / (magnitude + reference) : 0
