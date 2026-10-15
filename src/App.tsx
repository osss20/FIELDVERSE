import { useState } from 'react'
import { constrainMove, constrainRotate, findFreeSpot } from './model/magnetShape'
import { makeDipole, STRENGTH, strengthOf, withStrength, type Dipole } from './physics/dipole'
import { scale, vec, type Vec2 } from './physics/vec2'
import { FieldCanvas, VIEW_HEIGHT } from './view/FieldCanvas'
import { MagnetPanel } from './view/MagnetPanel'

const initialDipoles = (): Dipole[] => [makeDipole('m1', -0.6, 0, 1, 0), makeDipole('m2', 0.6, 0, 1, 0)]

let nextId = 3

const BLOCKED_MESSAGE = 'Blocked: magnets can’t overlap.'

export default function App() {
  const [dipoles, setDipoles] = useState<Dipole[]>(initialDipoles)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [blockedId, setBlockedId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const replace = (id: string, patch: Partial<Dipole>) =>
    setDipoles((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const reportBlocked = (id: string, blocked: boolean) => {
    setBlockedId(blocked ? id : null)
    setMessage(blocked ? BLOCKED_MESSAGE : '')
  }

  const move = (id: string, target: Vec2) => {
    const r = constrainMove(dipoles, id, target)
    replace(id, { position: r.value })
    reportBlocked(id, r.blocked)
  }

  const rotate = (id: string, angle: number) => {
    const r = constrainRotate(dipoles, id, angle)
    replace(id, { moment: r.value })
    reportBlocked(id, r.blocked)
  }

  // The message stays after release so it can be read; the next free move clears it.
  const endDrag = () => setBlockedId(null)

  const addMagnet = () => {
    const id = `m${nextId++}`
    const candidate = makeDipole(id, 0, 0, 0, -STRENGTH.default)
    // Keep new magnets inside the default view, clear of the others.
    const spot = findFreeSpot(dipoles, candidate, vec(0, 0.8), vec(1.6, VIEW_HEIGHT / 2 - 0.2))
    if (!spot) {
      setMessage('No free space for another magnet. Move or remove one first.')
      return
    }
    setDipoles((ds) => [...ds, { ...candidate, position: spot }])
    setSelectedId(id)
    setMessage('')
  }

  const selected = dipoles.find((d) => d.id === selectedId) ?? null
  const selectedIndex = selected ? dipoles.indexOf(selected) : -1

  return (
    <div className="app">
      <header className="toolbar">
        <h1>FIELDVERSE</h1>
        <button onClick={addMagnet}>Add magnet</button>
        <button
          onClick={() => {
            setDipoles(initialDipoles())
            setSelectedId(null)
            setMessage('')
          }}
        >
          Reset
        </button>
        <span className="hint">Drag a magnet to move it · drag its dot to rotate</span>
      </header>
      <MagnetPanel
        magnet={selected}
        label={selected ? `Magnet ${selectedIndex + 1}` : ''}
        strength={selected ? strengthOf(selected) : STRENGTH.default}
        message={message}
        onStrength={(s) => selected && setDipoles((ds) => ds.map((d) => (d.id === selected.id ? withStrength(d, s) : d)))}
        // Flipping turns the bar 180° about its centre, so it covers the same area.
        onFlip={() => selected && replace(selected.id, { moment: scale(selected.moment, -1) })}
        onRemove={() => {
          if (!selected) return
          setDipoles((ds) => ds.filter((d) => d.id !== selected.id))
          setSelectedId(null)
        }}
      />
      <main className="stage">
        <FieldCanvas
          dipoles={dipoles}
          selectedId={selectedId}
          blockedId={blockedId}
          onSelect={setSelectedId}
          onMove={move}
          onRotate={rotate}
          onDragEnd={endDrag}
        />
      </main>
    </div>
  )
}
