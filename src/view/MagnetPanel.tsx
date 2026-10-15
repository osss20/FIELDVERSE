import { useId } from 'react'
import { STRENGTH, type Dipole } from '../physics/dipole'

interface Props {
  dipoles: readonly Dipole[]
  labels: Readonly<Record<string, string>>
  selected: Dipole | null
  strength: number
  /** Heading of the selected magnet's north end, degrees anticlockwise from +x. */
  heading: number
  canAdd: boolean
  onSelect: (id: string | null) => void
  onAdd: () => void
  onFlip: () => void
  onRemove: () => void
  onRotateBy: (degrees: number) => void
  onReset: () => void
  onStrength: (value: number) => void
  /** Called when a strength drag or key change finishes. */
  onStrengthCommit: () => void
}

/** Magnet tools and the selected magnet's settings. */
export function MagnetPanel(p: Props) {
  const sliderId = useId()
  const pickerId = useId()
  const none = !p.selected
  return (
    <section className="card" aria-labelledby={`${pickerId}-h`}>
      <h2 id={`${pickerId}-h`} className="card-title">
        Magnets
      </h2>
      <div className="tool-row">
        <button type="button" onClick={p.onAdd} disabled={!p.canAdd}>
          Add
        </button>
        <button type="button" onClick={p.onFlip} disabled={none} title="Swap north and south">
          Flip
        </button>
        <button type="button" onClick={p.onRemove} disabled={none}>
          Remove
        </button>
        <button type="button" onClick={p.onReset} title="Restore the starting experiment">
          Reset
        </button>
      </div>

      <div className="field-row">
        <label htmlFor={pickerId}>Selected</label>
        <select id={pickerId} value={p.selected?.id ?? ''} onChange={(e) => p.onSelect(e.target.value || null)}>
          <option value="">None</option>
          {p.dipoles.map((d) => (
            <option key={d.id} value={d.id}>
              Magnet {p.labels[d.id]}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor={sliderId}>Strength</label>
        <input
          id={sliderId}
          type="range"
          min={STRENGTH.min}
          max={STRENGTH.max}
          step={STRENGTH.step}
          value={p.strength}
          disabled={none}
          onChange={(e) => p.onStrength(Number(e.target.value))}
          onPointerUp={p.onStrengthCommit}
          onKeyUp={p.onStrengthCommit}
          aria-valuetext={`${p.strength.toFixed(1)} ampere square metres, model value`}
        />
        <output htmlFor={sliderId} className="readout" title="Dipole moment |m| in model units">
          {none ? '—' : `${p.strength.toFixed(1)} A·m²`}
        </output>
      </div>

      <div className="field-row">
        <span className="label">Heading</span>
        <div className="tool-row tight">
          <button type="button" onClick={() => p.onRotateBy(15)} disabled={none} aria-label="Rotate 15 degrees anticlockwise">
            ⟲ 15°
          </button>
          <button type="button" onClick={() => p.onRotateBy(-15)} disabled={none} aria-label="Rotate 15 degrees clockwise">
            ⟳ 15°
          </button>
        </div>
        <output className="readout">{none ? '—' : `${Math.round(p.heading)}°`}</output>
      </div>
      <p className="hint">Drag a magnet to move it. Drag the dot at its north end to rotate.</p>
    </section>
  )
}
