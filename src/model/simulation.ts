import { netLoads, pairInteraction, polePairing, type InteractionKind, type NetLoad, type PolePairing } from '../physics/interaction'
import type { Dipole } from '../physics/dipole'
import { add, distance, fromAngle, isFiniteVec, length, scale, vec, type Vec2 } from '../physics/vec2'
import { bodyHalfLength, CLEARANCE, constrainMove, constrainRotate, penetration, type GapFn } from './magnetShape'

/**
 * Tabletop magnet dynamics: an explicit, simplified model on top of the
 * point-dipole forces in physics/interaction.
 *
 * - Static friction: a magnet stays put until the net force (or torque) on it
 *   exceeds a threshold, like a magnet resting on a table. This is why distant
 *   magnets don't creep together and why strength changes the reach.
 * - Overdamped motion: above the threshold, velocity is proportional to the
 *   excess force (v = μ·(F − F_s)), as if sliding through heavy friction. No
 *   inertia, so magnets never overshoot or oscillate.
 * - Contact: bodies keep CLEARANCE apart, except an attached pair, which may
 *   close to ATTACHED_GAP (visually touching).
 *
 * All constants are model values chosen for a readable experiment, not
 * measured properties of real magnets.
 */
export const SIM = {
  /** Static friction force threshold (N, model). */
  staticForce: 1.5e-5,
  /** Static friction torque threshold (N·m, model). */
  staticTorque: 5e-6,
  /** Translational mobility (m·s⁻¹ per N of excess force, model). */
  mobility: 1.3e4,
  /** Rotational mobility (rad·s⁻¹ per N·m of excess torque, model). */
  rotMobility: 1e6,
  maxSpeed: 2, // m/s
  maxSpin: 6, // rad/s
  /** Gap kept between an attached pair (m). */
  attachedGap: 0.002,
  /** Extra tolerance beyond CLEARANCE within which an attracting pair counts as touching (m). */
  attachTolerance: 0.004,
  /** An attached pair separates once its surface gap exceeds this (m). */
  releaseGap: CLEARANCE + 0.03,
  /** Pair state enters attract/repel at this force and leaves below `eventOff` (hysteresis). */
  eventOn: 1.5e-5,
  eventOff: 0.9e-5,
  /** How far the held magnet is pushed or pulled from the pointer per newton (m/N, model). */
  dragCompliance: 500,
  maxDragLag: 0.1, // m
  /** Pointer distance needed to pull an attached magnet free (m). */
  breakaway: 0.08,
  /** Fixed physics substep (s) and the longest frame the step will integrate (s). */
  substep: 1 / 240,
  maxFrame: 1 / 30,
} as const

export type PairPhase = 'none' | InteractionKind

export interface DragState {
  id: string
  mode: 'move' | 'rotate'
  /** Requested centre for a move drag (pointer minus grab offset). */
  target?: Vec2
}

export interface SimState {
  dipoles: Dipole[]
  /** Attached pairs as sorted "idA|idB" keys. */
  attached: string[]
  phases: Record<string, PairPhase>
  drag: DragState | null
}

export type SimEvent =
  | { type: 'attract' | 'repel'; a: string; b: string; pairing: PolePairing; at: Vec2 }
  | { type: 'attach' | 'detach'; a: string; b: string; pairing: PolePairing; at: Vec2 }

export interface Bounds {
  /** Half-extents of the area magnets must stay inside (m), centred on the origin. */
  halfWidth: number
  halfHeight: number
}

export interface StepResult {
  state: SimState
  events: SimEvent[]
  /** Net force and torque per magnet (same order as state.dipoles), for indicators. */
  loads: NetLoad[]
  /** True while something is still moving or held, i.e. the loop should keep running. */
  active: boolean
  /** True when the held magnet is being held back by an attachment. */
  holding: boolean
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const initialSimState = (dipoles: Dipole[]): SimState => ({ dipoles, attached: [], phases: {}, drag: null })

/** Clearance rule: attached pairs may sit closer than everyone else. */
export const gapFor =
  (attached: readonly string[]): GapFn =>
  (a, b) =>
    attached.includes(pairKey(a.id, b.id)) ? SIM.attachedGap : CLEARANCE

/** Removes a magnet and every attachment or phase that mentions it. */
export function withoutMagnet(state: SimState, id: string): SimState {
  const keep = (k: string) => !k.split('|').includes(id)
  return {
    ...state,
    dipoles: state.dipoles.filter((d) => d.id !== id),
    attached: state.attached.filter(keep),
    phases: Object.fromEntries(Object.entries(state.phases).filter(([k]) => keep(k))),
    drag: state.drag?.id === id ? null : state.drag,
  }
}

const pairingOf = (a: Dipole, b: Dipole) => polePairing(a, b, bodyHalfLength(a), bodyHalfLength(b))
const midpoint = (p: PolePairing) => scale(add(p.pointA, p.pointB), 0.5)

/** Friction: keep only the part of a load above its static threshold. */
const excess = (magnitude: number, threshold: number) => (magnitude > threshold ? 1 - threshold / magnitude : 0)

const clampToBounds = (d: Dipole, p: Vec2, b: Bounds): Vec2 => {
  const m = bodyHalfLength(d)
  return vec(
    Math.min(b.halfWidth - m, Math.max(-b.halfWidth + m, p.x)),
    Math.min(b.halfHeight - m, Math.max(-b.halfHeight + m, p.y)),
  )
}

/**
 * Where the held magnet sits for a pointer target: offset by the net force
 * acting on it (so it visibly resists or is pulled), clamped, and held in
 * place while attached until the pointer moves `breakaway` away.
 */
function placeHeld(
  state: SimState,
  load: NetLoad,
  bounds: Bounds,
): { state: SimState; events: SimEvent[]; holding: boolean } {
  const drag = state.drag!
  const held = state.dipoles.find((d) => d.id === drag.id)
  if (!held || drag.mode !== 'move' || !drag.target || !isFiniteVec(drag.target)) {
    return { state, events: [], holding: false }
  }
  let lag = scale(load.force, SIM.dragCompliance)
  if (length(lag) > SIM.maxDragLag) lag = scale(lag, SIM.maxDragLag / length(lag))
  const desired = clampToBounds(held, add(drag.target, lag), bounds)

  const mine = state.attached.filter((k) => k.split('|').includes(held.id))
  const events: SimEvent[] = []
  let attached = state.attached
  if (mine.length > 0) {
    if (distance(drag.target, held.position) < SIM.breakaway) return { state, events, holding: true }
    // Pulled hard enough: separate from every partner.
    attached = state.attached.filter((k) => !mine.includes(k))
    for (const k of mine) {
      const [ia, ib] = k.split('|')
      const a = state.dipoles.find((d) => d.id === ia)!
      const b = state.dipoles.find((d) => d.id === ib)!
      const pairing = pairingOf(a, b)
      events.push({ type: 'detach', a: ia, b: ib, pairing, at: midpoint(pairing) })
    }
  }
  const moved = constrainMove(state.dipoles, held.id, desired, gapFor(attached))
  const dipoles = state.dipoles.map((d) => (d.id === held.id ? { ...d, position: moved.value } : d))
  return { state: { ...state, dipoles, attached }, events, holding: false }
}

/** Updates attract/repel phases with hysteresis and reports pairs that just started interacting. */
function updatePhases(state: SimState): { phases: Record<string, PairPhase>; events: SimEvent[] } {
  const phases: Record<string, PairPhase> = {}
  const events: SimEvent[] = []
  const ds = state.dipoles
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]
      const b = ds[j]
      const key = pairKey(a.id, b.id)
      const prev = state.phases[key] ?? 'none'
      const p = pairInteraction(a, b)
      let next: PairPhase = prev
      if (p.magnitude >= SIM.eventOn) next = p.kind
      else if (p.magnitude < SIM.eventOff) next = 'none'
      else if (prev !== 'none') next = p.kind
      phases[key] = next
      if (next !== 'none' && next !== prev) {
        const pairing = pairingOf(a, b)
        events.push({ type: next, a: a.id, b: b.id, pairing, at: midpoint(pairing) })
      }
    }
  }
  return { phases, events }
}

/** Attaches touching attracting pairs and releases attached pairs that have moved apart. */
function updateAttachments(state: SimState): { attached: string[]; events: SimEvent[] } {
  const events: SimEvent[] = []
  const attached = new Set(state.attached)
  const ds = state.dipoles
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]
      const b = ds[j]
      const key = pairKey(a.id, b.id)
      if (attached.has(key)) {
        if (penetration(a, b, SIM.releaseGap) === 0) {
          attached.delete(key)
          const pairing = pairingOf(a, b)
          events.push({ type: 'detach', a: a.id, b: b.id, pairing, at: midpoint(pairing) })
        }
        continue
      }
      const touching = penetration(a, b, CLEARANCE + SIM.attachTolerance) > 0
      if (touching && state.phases[key] === 'attract') {
        attached.add(key)
        const pairing = pairingOf(a, b)
        events.push({ type: 'attach', a: a.id, b: b.id, pairing, at: midpoint(pairing) })
      }
    }
  }
  return { attached: [...attached].sort(), events }
}

/** One physics substep: friction-limited, overdamped motion of every magnet that isn't held. */
function moveFree(state: SimState, loads: NetLoad[], h: number, bounds: Bounds): { dipoles: Dipole[]; moved: boolean } {
  let dipoles = state.dipoles
  let moved = false
  const gap = gapFor(state.attached)
  state.dipoles.forEach((d, i) => {
    if (state.drag?.id === d.id) return
    const { force, torque } = loads[i]
    const fMag = length(force)
    let v = scale(force, SIM.mobility * excess(fMag, SIM.staticForce))
    if (length(v) > SIM.maxSpeed) v = scale(v, SIM.maxSpeed / length(v))
    let w = SIM.rotMobility * torque * excess(Math.abs(torque), SIM.staticTorque)
    w = Math.max(-SIM.maxSpin, Math.min(SIM.maxSpin, w))

    const current = dipoles.find((x) => x.id === d.id)!
    let next = current
    if (length(v) * h > 1e-7) {
      const target = clampToBounds(current, add(current.position, scale(v, h)), bounds)
      const r = constrainMove(dipoles, d.id, target, gap)
      next = { ...next, position: r.value }
    }
    if (Math.abs(w * h) > 1e-7) {
      const angle = Math.atan2(current.moment.y, current.moment.x) + w * h
      const r = constrainRotate(dipoles.map((x) => (x.id === d.id ? next : x)), d.id, angle, gap)
      next = { ...next, moment: r.value }
    }
    if (next !== current) {
      if (distance(next.position, current.position) > 1e-7 || distance(next.moment, current.moment) > 1e-9 * length(current.moment)) {
        moved = true
      }
      dipoles = dipoles.map((x) => (x.id === d.id ? next : x))
    }
  })
  return { dipoles, moved }
}

/**
 * Advances the experiment by `dt` seconds (capped at SIM.maxFrame) in fixed
 * substeps. Pure: returns the new state, the interaction events that fired,
 * the loads for force indicators, and whether anything is still active.
 */
export function step(state: SimState, dt: number, bounds: Bounds): StepResult {
  const frame = Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), SIM.maxFrame)
  const n = Math.max(1, Math.ceil(frame / SIM.substep))
  const h = frame / n
  const events: SimEvent[] = []
  let s = state
  let moved = false
  let holding = false
  let loads = netLoads(s.dipoles)

  for (let i = 0; i < n; i++) {
    if (s.drag) {
      const idx = s.dipoles.findIndex((d) => d.id === s.drag!.id)
      const placed = placeHeld(s, loads[idx] ?? { force: vec(0, 0), torque: 0 }, bounds)
      s = placed.state
      holding = placed.holding
      events.push(...placed.events)
      loads = netLoads(s.dipoles)
    }
    if (h > 0) {
      const r = moveFree(s, loads, h, bounds)
      moved ||= r.moved
      s = { ...s, dipoles: r.dipoles }
    }
    const ph = updatePhases(s)
    s = { ...s, phases: ph.phases }
    events.push(...ph.events)
    const at = updateAttachments(s)
    s = { ...s, attached: at.attached }
    events.push(...at.events)
    loads = netLoads(s.dipoles)
  }
  return { state: s, events, loads, active: moved || s.drag !== null, holding }
}

/** Unit vector helper for callers that rotate a magnet by an angle. */
export const rotatedMoment = (d: Dipole, angle: number): Vec2 => fromAngle(angle, length(d.moment))

/** Keeps a pose inside the bounds; exported for adding magnets and presets. */
export const insideBounds = (d: Dipole, bounds: Bounds): Dipole => ({ ...d, position: clampToBounds(d, d.position, bounds) })
