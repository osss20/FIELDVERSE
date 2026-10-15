import type { Dipole } from '../physics/dipole'
import { interactionLevel, pairInteraction, polePairing, type InteractionKind, type PolePairing } from '../physics/interaction'
import { bodyHalfLength, surfaceGap } from './magnetShape'
import { pairKey, SIM, type SimEvent } from './simulation'

/** Status line for an interaction event. Text matches the pole pairing, so it never claims a principle the geometry doesn't show. */
export function eventMessage(e: SimEvent): string {
  switch (e.type) {
    case 'attract':
      return e.pairing.like ? 'Magnets attract: the net dipole force pulls them together.' : 'Opposite poles attract.'
    case 'repel':
      return e.pairing.like ? 'Like poles repel.' : 'Magnets repel: the net dipole force pushes them apart.'
    case 'attach':
      return 'Magnetic connection established.'
    case 'detach':
      return 'Magnets separated.'
  }
}

export interface InteractionReadout {
  partnerId: string
  pairing: PolePairing
  /** Surface gap between the bodies (m, model geometry). */
  gap: number
  kind: InteractionKind
  /** Dimensionless 0–1 display level (0.5 at the friction threshold); not a force in newtons. */
  level: number
  attached: boolean
  /** True when the force is above the friction threshold, i.e. it can move a free magnet. */
  active: boolean
}

/** The strongest interaction acting on magnet `id`, or null if it has no partner. */
export function strongestInteraction(dipoles: readonly Dipole[], id: string, attached: readonly string[]): InteractionReadout | null {
  const me = dipoles.find((d) => d.id === id)
  if (!me) return null
  let best: InteractionReadout | null = null
  let bestMag = -1
  for (const other of dipoles) {
    if (other.id === id) continue
    const p = pairInteraction(other, me)
    if (p.magnitude <= bestMag) continue
    bestMag = p.magnitude
    best = {
      partnerId: other.id,
      pairing: polePairing(me, other, bodyHalfLength(me), bodyHalfLength(other)),
      gap: surfaceGap(me, other),
      kind: p.kind,
      level: interactionLevel(p.magnitude, SIM.staticForce),
      attached: attached.includes(pairKey(me.id, other.id)),
      active: p.magnitude >= SIM.staticForce,
    }
  }
  return best
}

/** "3.4 cm" / "12 cm" style distance for model metres. */
export const formatGap = (m: number): string => {
  const cm = m * 100
  return cm < 10 ? `${cm.toFixed(1)} cm` : `${Math.round(cm)} cm`
}
