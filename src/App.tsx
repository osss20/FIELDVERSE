import { useState } from 'react'
import { makeDipole, type Dipole } from './physics/dipole'
import { scale } from './physics/vec2'
import { FieldCanvas } from './view/FieldCanvas'

const initialDipoles = (): Dipole[] => [makeDipole('m1', -0.6, 0, 1, 0), makeDipole('m2', 0.6, 0, 1, 0)]

let nextId = 3

export default function App() {
  const [dipoles, setDipoles] = useState<Dipole[]>(initialDipoles)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const update = (id: string, patch: Partial<Pick<Dipole, 'position' | 'moment'>>) =>
    setDipoles((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const addMagnet = () => {
    const id = `m${nextId++}`
    setDipoles((ds) => [...ds, makeDipole(id, 0, 0.8, 0, -1)])
    setSelectedId(id)
  }

  const selected = dipoles.find((d) => d.id === selectedId)

  return (
    <div className="app">
      <header className="toolbar">
        <h1>FIELDVERSE</h1>
        <button onClick={addMagnet}>Add magnet</button>
        <button disabled={!selected} onClick={() => selected && update(selected.id, { moment: scale(selected.moment, -1) })}>
          Flip
        </button>
        <button
          disabled={!selected}
          onClick={() => {
            setDipoles((ds) => ds.filter((d) => d.id !== selectedId))
            setSelectedId(null)
          }}
        >
          Remove
        </button>
        <button
          onClick={() => {
            setDipoles(initialDipoles())
            setSelectedId(null)
          }}
        >
          Reset
        </button>
        <span className="hint">Drag a magnet to move it · drag its dot to rotate</span>
      </header>
      <main className="stage">
        <FieldCanvas dipoles={dipoles} selectedId={selectedId} onSelect={setSelectedId} onChange={update} />
      </main>
    </div>
  )
}
