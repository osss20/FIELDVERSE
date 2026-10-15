import { formatGap, type InteractionReadout } from '../model/feedback'

interface Props {
  /** Latest feedback line; announced politely to screen readers. */
  message: string
  /** Strongest interaction on the selected magnet (or the strongest pair when none is selected). */
  readout: InteractionReadout | null
  subjectLabel: string | null
  partnerLabel: string | null
}

/** Interaction feedback: what just happened, and what the selected magnet is feeling. */
export function StatusPanel({ message, readout, subjectLabel, partnerLabel }: Props) {
  const level = readout ? Math.round(readout.level * 100) : 0
  const state = !readout
    ? null
    : readout.attached
      ? 'Attached'
      : !readout.active
        ? 'At rest'
        : readout.kind === 'attract'
          ? 'Attracting'
          : 'Repelling'
  const tone = !readout ? '' : readout.attached || (readout.active && readout.kind === 'attract') ? 'attract' : readout.active ? 'repel' : 'idle'
  return (
    <section className="card" aria-labelledby="status-h">
      <h2 id="status-h" className="card-title">
        Interaction
      </h2>
      <p className="status-message" role="status" aria-live="polite">
        {message || 'Move a magnet to see how it interacts.'}
      </p>
      {readout && subjectLabel && partnerLabel ? (
        <dl className="readouts">
          <div>
            <dt>Pair</dt>
            <dd>
              {subjectLabel} ↔ {partnerLabel}
            </dd>
          </div>
          <div>
            <dt>Facing poles</dt>
            <dd>
              <span className={`pole pole-${readout.pairing.a}`}>{readout.pairing.a}</span>
              <span aria-hidden="true"> – </span>
              <span className={`pole pole-${readout.pairing.b}`}>{readout.pairing.b}</span>
              <span className="muted"> {readout.pairing.like ? 'like' : 'opposite'}</span>
            </dd>
          </div>
          <div>
            <dt>Gap</dt>
            <dd>{formatGap(readout.gap)}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>
              <span className={`chip chip-${tone}`}>{state}</span>
            </dd>
          </div>
          <div className="meter-row">
            <dt id="meter-label">Interaction strength</dt>
            <dd>
              <div
                className={`meter meter-${tone}`}
                role="meter"
                aria-labelledby="meter-label"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={level}
                aria-valuetext={`${level} percent, relative`}
              >
                <span style={{ width: `${level}%` }} />
              </div>
              <span className="meter-note">Relative scale (50% = enough to move a magnet). Not a force in newtons.</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted small">Select a magnet to see its strongest interaction.</p>
      )}
    </section>
  )
}
