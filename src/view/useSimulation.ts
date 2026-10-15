import { useCallback, useEffect, useRef, useState } from 'react'
import { initialSimState, step, type Bounds, type SimState, type StepResult } from '../model/simulation'
import type { Dipole } from '../physics/dipole'
import { netLoads, type NetLoad } from '../physics/interaction'

export interface SimView {
  state: SimState
  loads: NetLoad[]
  holding: boolean
  blocked: boolean
}

/**
 * Owns the simulation state and runs `step` in a requestAnimationFrame loop
 * only while something is moving or held. Any change made through `update`
 * restarts the loop for at least one step, so interactions caused by the
 * change (a flip that turns attraction into repulsion, say) are evaluated.
 * The loop is cancelled on unmount.
 */
export function useSimulation(initial: () => Dipole[], onStep: (r: StepResult) => void) {
  const [view, setView] = useState<SimView>(() => {
    const state = initialSimState(initial())
    return { state, loads: netLoads(state.dipoles), holding: false, blocked: false }
  })
  // The loop reads and writes the live state through a ref; React state mirrors it for rendering.
  const stateRef = useRef<SimState>(view.state)
  const boundsRef = useRef<Bounds>({ halfWidth: 2, halfHeight: 1.5 })
  const onStepRef = useRef(onStep)
  useEffect(() => {
    onStepRef.current = onStep
  })
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)

  const frame = useCallback(function frame(t: number) {
    const dt = lastRef.current ? (t - lastRef.current) / 1000 : 0
    lastRef.current = t
    const r = step(stateRef.current, dt, boundsRef.current)
    stateRef.current = r.state
    setView({ state: r.state, loads: r.loads, holding: r.holding, blocked: r.blocked })
    onStepRef.current(r)
    rafRef.current = r.active ? requestAnimationFrame(frame) : null
  }, [])

  const kick = useCallback(() => {
    if (rafRef.current !== null) return
    lastRef.current = 0
    rafRef.current = requestAnimationFrame(frame)
  }, [frame])

  /** Applies a change to the simulation state and makes sure it gets stepped. */
  const update = useCallback(
    (fn: (s: SimState) => SimState) => {
      stateRef.current = fn(stateRef.current)
      setView((v) => ({ ...v, state: stateRef.current }))
      kick()
    },
    [kick],
  )

  const setBounds = useCallback(
    (b: Bounds) => {
      boundsRef.current = b
      kick()
    },
    [kick],
  )

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    [],
  )

  return { view, update, setBounds, stateRef, boundsRef }
}

/** Tracks the user's reduced-motion preference. */
export function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const m = window.matchMedia(query)
    const on = () => setReduced(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return reduced
}
