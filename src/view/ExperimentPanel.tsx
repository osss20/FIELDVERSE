import { useId } from 'react'
import type { Preset } from '../model/presets'

interface Props {
  presets: readonly Preset[]
  current: Preset
  /** True once the user has changed the layout since loading the preset. */
  modified: boolean
  onLoad: (id: string) => void
}

/** Preset experiments and the principle each one shows. */
export function ExperimentPanel({ presets, current, modified, onLoad }: Props) {
  const id = useId()
  return (
    <section className="card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="card-title">
        Experiment
      </h2>
      <div className="field-row">
        <label htmlFor={id}>Preset</label>
        <select id={id} value={current.id} onChange={(e) => onLoad(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => onLoad(current.id)} title="Start this experiment again">
          Run
        </button>
      </div>
      <p className="principle">{current.principle}</p>
      {modified && current.id !== 'free' ? <p className="muted small">You’ve changed the layout: free exploration.</p> : null}
    </section>
  )
}
