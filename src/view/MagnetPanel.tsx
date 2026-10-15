import { useId } from 'react'
import { STRENGTH, type Dipole } from '../physics/dipole'

interface Props {
  magnet: Dipole | null
  label: string
  strength: number
  /** Feedback such as a blocked move; announced to screen readers. */
  message: string
  onStrength: (value: number) => void
  onFlip: () => void
  onRemove: () => void
}

/** Controls for the selected magnet. Always rendered so the layout doesn't jump. */
export function MagnetPanel({ magnet, label, strength, message, onStrength, onFlip, onRemove }: Props) {
  const sliderId = useId()
  return (
    <section className="panel" aria-label="Selected magnet">
      {magnet ? (
        <>
          <strong className="panel-title">{label}</strong>
          <label htmlFor={sliderId} className="panel-label">
            Strength
          </label>
          <input
            id={sliderId}
            type="range"
            min={STRENGTH.min}
            max={STRENGTH.max}
            step={STRENGTH.step}
            value={strength}
            onChange={(e) => onStrength(Number(e.target.value))}
            aria-valuetext={`${strength.toFixed(1)} ampere square metres`}
          />
          <output htmlFor={sliderId} className="panel-value" title="Dipole moment |m| in model units">
            |m| = {strength.toFixed(1)} A·m²
          </output>
          <button onClick={onFlip}>Flip</button>
          <button onClick={onRemove}>Remove</button>
        </>
      ) : (
        <span className="panel-empty">Select a magnet to adjust its strength.</span>
      )}
      <span className="panel-message" role="status" aria-live="polite">
        {message}
      </span>
    </section>
  )
}
