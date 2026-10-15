import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SoundEngine } from './audio/soundEngine'
import { eventMessage, strongestInteraction, type InteractionReadout } from './model/feedback'
import { constrainRotate, findFreeSpot } from './model/magnetShape'
import { FREE_EXPERIMENT, presetById, PRESETS } from './model/presets'
import { gapFor, initialSimState, withoutMagnet, type Bounds, type SimState, type StepResult } from './model/simulation'
import { makeDipole, STRENGTH, strengthOf, withStrength, type Dipole } from './physics/dipole'
import { scale, vec, type Vec2 } from './physics/vec2'
import { ExperimentPanel } from './view/ExperimentPanel'
import { FieldCanvas, type Pulse } from './view/FieldCanvas'
import { MagnetPanel } from './view/MagnetPanel'
import { StatusPanel } from './view/StatusPanel'
import { usePrefersReducedMotion, useSimulation } from './view/useSimulation'

const MESSAGES = {
  blocked: 'Magnets can’t overlap.',
  holding: 'Attached. Pull further to separate them.',
  updated: 'Magnetic field updated.',
  added: 'Magnet added.',
  removed: 'Magnet removed.',
  reset: 'Experiment reset.',
  noRoom: 'No free space for another magnet. Move or remove one first.',
} as const

let pulseId = 0
let magnetSerial = 100

const headingOf = (d: Dipole) => (Math.atan2(d.moment.y, d.moment.x) * 180) / Math.PI

export default function App() {
  const [engine] = useState(() => new SoundEngine())
  const sound = useRef(engine)
  const reducedMotion = usePrefersReducedMotion()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [presetId, setPresetId] = useState(FREE_EXPERIMENT.id)
  const [modified, setModified] = useState(false)
  const [message, setMessage] = useState('')
  const [pulses, setPulses] = useState<Pulse[]>([])
  const [showField, setShowField] = useState(true)
  const [showForces, setShowForces] = useState(true)
  const [soundOn, setSoundOn] = useState(true)

  /** Sounds, pulses and status text for whatever the last physics step reported. */
  const onStep = useCallback((r: StepResult) => {
    if (r.events.length > 0) {
      const now = performance.now()
      for (const e of r.events) {
        sound.current.play(e.type, `${e.a}|${e.b}`)
      }
      setPulses((ps) => [
        ...ps.filter((p) => now - p.start < 1000),
        ...r.events.map((e) => ({ id: pulseId++, at: e.at, kind: e.type, start: now })),
      ])
      setMessage(eventMessage(r.events[r.events.length - 1]))
    } else if (r.holding) setMessage(MESSAGES.holding)
    else if (r.blocked) setMessage(MESSAGES.blocked)
  }, [])

  const sim = useSimulation(FREE_EXPERIMENT.build, onStep)
  const { state } = sim.view
  const { update, setBounds } = sim

  // Audio may only start after a user gesture; unlock on the first one, release on unmount.
  useEffect(() => {
    const engine = sound.current
    const unlock = () => engine.unlock()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      engine.dispose()
    }
  }, [])
  useEffect(() => {
    sound.current.enabled = soundOn
  }, [soundOn])

  const selected = state.dipoles.find((d) => d.id === selectedId) ?? null
  const labels = useMemo(() => Object.fromEntries(state.dipoles.map((d, i) => [d.id, String(i + 1)])), [state.dipoles])
  const canvasLabels = useMemo(() => Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, `M${v}`])), [labels])

  const touched = () => setModified(true)
  const mapMagnet = (id: string, fn: (d: Dipole) => Dipole) => (s: SimState) => ({
    ...s,
    dipoles: s.dipoles.map((d) => (d.id === id ? fn(d) : d)),
  })

  const rotateTo = (id: string, angle: number) => {
    let blocked = false
    update((s) => {
      const r = constrainRotate(s.dipoles, id, angle, gapFor(s.attached))
      blocked = r.blocked
      return mapMagnet(id, (d) => ({ ...d, moment: r.value }))(s)
    })
    setMessage(blocked ? MESSAGES.blocked : MESSAGES.updated)
    touched()
  }

  const loadPreset = (id: string) => {
    const p = presetById(id)
    update(() => initialSimState(p.build()))
    setPresetId(p.id)
    setModified(false)
    setSelectedId(null)
    setPulses([])
    setMessage(p.id === FREE_EXPERIMENT.id ? MESSAGES.reset : `${p.name}: watch what happens.`)
  }

  const addMagnet = () => {
    const id = `m${magnetSerial++}`
    const candidate = makeDipole(id, 0, 0, 0, -STRENGTH.default)
    const b = sim.boundsRef.current
    const spot = findFreeSpot(state.dipoles, candidate, vec(0, 0.8), vec(b.halfWidth - 0.2, b.halfHeight - 0.2))
    if (!spot) {
      setMessage(MESSAGES.noRoom)
      return
    }
    update((s) => ({ ...s, dipoles: [...s.dipoles, { ...candidate, position: spot }] }))
    setSelectedId(id)
    setMessage(MESSAGES.added)
    sound.current.play('add')
    touched()
  }

  const removeSelected = () => {
    if (!selected) return
    update((s) => withoutMagnet(s, selected.id))
    setSelectedId(null)
    setMessage(MESSAGES.removed)
    sound.current.play('remove')
    touched()
  }

  const flipSelected = () => {
    if (!selected) return
    // A 180° turn about the centre covers the same area, so no overlap check is needed.
    update(mapMagnet(selected.id, (d) => ({ ...d, moment: scale(d.moment, -1) })))
    setMessage(MESSAGES.updated)
    touched()
  }

  // The interaction readout: the selected magnet, or else the most strongly interacting one.
  const readout: { r: InteractionReadout; subject: string } | null = useMemo(() => {
    const ids = selectedId ? [selectedId] : state.dipoles.map((d) => d.id)
    let best: { r: InteractionReadout; subject: string } | null = null
    for (const id of ids) {
      const r = strongestInteraction(state.dipoles, id, state.attached)
      if (r && (!best || r.level > best.r.level)) best = { r, subject: id }
    }
    return best
  }, [state.dipoles, state.attached, selectedId])

  const onViewport = useCallback((b: Bounds) => setBounds(b), [setBounds])
  const dragTarget: Vec2 | null = state.drag?.mode === 'move' ? (state.drag.target ?? null) : null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">FIELDVERSE</span>
          <span className="brand-sub">Magnetic Field Lab</span>
        </div>
        <div className="toggles" role="group" aria-label="Display and sound">
          <Toggle label="Field lines" on={showField} onChange={setShowField} />
          <Toggle label="Forces" on={showForces} onChange={setShowForces} />
          <Toggle label="Sound" on={soundOn} onChange={setSoundOn} />
        </div>
      </header>

      <main className="workspace">
        <div className="stage">
          <FieldCanvas
            dipoles={state.dipoles}
            loads={sim.view.loads}
            attached={state.attached}
            phases={state.phases}
            selectedId={selectedId}
            heldId={state.drag?.id ?? null}
            dragTarget={dragTarget}
            blocked={sim.view.blocked}
            holding={sim.view.holding}
            showField={showField}
            showForces={showForces}
            animate={!reducedMotion}
            pulses={pulses}
            labels={canvasLabels}
            onSelect={setSelectedId}
            onDragStart={(id, mode) => {
              update((s) => {
                const d = s.dipoles.find((x) => x.id === id)
                return { ...s, drag: { id, mode, target: mode === 'move' ? d?.position : undefined } }
              })
            }}
            onDragMove={(id, target) => {
              update((s) => (s.drag?.id === id ? { ...s, drag: { ...s.drag, target } } : s))
              touched()
            }}
            onRotateTo={rotateTo}
            onDragEnd={() => update((s) => ({ ...s, drag: null }))}
            onViewport={onViewport}
            onGesture={() => sound.current.unlock()}
          />
          <p className="legend" aria-hidden="true">
            <span className="swatch swatch-field" /> field (brighter = stronger)
            <span className="swatch swatch-attract" /> attract
            <span className="swatch swatch-repel" /> repel
            {showForces ? (
              <>
                <span className="swatch swatch-force" /> net force
              </>
            ) : null}
          </p>
        </div>

        <aside className="sidebar">
          <StatusPanel
            message={message}
            readout={readout?.r ?? null}
            subjectLabel={readout ? `M${labels[readout.subject]}` : null}
            partnerLabel={readout ? `M${labels[readout.r.partnerId]}` : null}
          />
          <MagnetPanel
            dipoles={state.dipoles}
            labels={labels}
            selected={selected}
            strength={selected ? strengthOf(selected) : STRENGTH.default}
            heading={selected ? headingOf(selected) : 0}
            canAdd={state.dipoles.length < 8}
            onSelect={setSelectedId}
            onAdd={addMagnet}
            onFlip={flipSelected}
            onRemove={removeSelected}
            onRotateBy={(deg) => {
              if (!selected) return
              const a = Math.atan2(selected.moment.y, selected.moment.x) + (deg * Math.PI) / 180
              rotateTo(selected.id, a)
            }}
            onReset={() => loadPreset(FREE_EXPERIMENT.id)}
            onStrength={(v) => {
              if (!selected) return
              update(mapMagnet(selected.id, (d) => withStrength(d, v)))
              touched()
            }}
            onStrengthCommit={() => selected && setMessage(MESSAGES.updated)}
          />
          <ExperimentPanel presets={PRESETS} current={presetById(presetId)} modified={modified} onLoad={loadPreset} />
          <p className="model-note">
            Model: ideal point dipoles with model strengths, plus tabletop friction. Distances are in model metres;
            strengths and forces are for exploring, not measurements of real magnets.
          </p>
        </aside>
      </main>
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="toggle" aria-pressed={on} onClick={() => onChange(!on)}>
      <span className="toggle-dot" aria-hidden="true" />
      {label}
    </button>
  )
}
