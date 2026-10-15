import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { bodyHalfLength, bodyHalfWidth, hitsBody } from '../model/magnetShape'
import { axisOf, type Dipole } from '../physics/dipole'
import { computeFieldLines, DEFAULT_LINE_SET, type Bounds, type FieldLine } from '../physics/fieldLines'
import { add, distance, length, scale, sub, vec, type Vec2 } from '../physics/vec2'

/** World units (m) visible vertically; width follows the canvas aspect ratio. */
export const VIEW_HEIGHT = 3
/** Extra world margin beyond the visible area where lines keep being traced. */
const TRACE_MARGIN = 0.5

interface Props {
  dipoles: readonly Dipole[]
  selectedId: string | null
  /** Magnet whose last drag step was limited by an overlap. */
  blockedId: string | null
  onSelect: (id: string | null) => void
  /** Requested position; the parent applies overlap rules. */
  onMove: (id: string, target: Vec2) => void
  /** Requested moment angle (rad from +x); the parent applies overlap rules. */
  onRotate: (id: string, angle: number) => void
  onDragEnd: () => void
}

type Drag = { kind: 'move'; id: string; grab: Vec2 } | { kind: 'rotate'; id: string }

export function FieldCanvas({ dipoles, selectedId, blockedId, onSelect, onMove, onRotate, onDragEnd }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [drag, setDrag] = useState<Drag | null>(null)
  // Bumped when the colour theme changes, so the canvas repaints with the new tokens.
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const bump = () => setThemeVersion((v) => v + 1)
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', bump)
    const mo = new MutationObserver(bump)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      media.removeEventListener('change', bump)
      mo.disconnect()
    }
  }, [])

  useLayoutEffect(() => {
    const el = canvasRef.current!
    // Measure now; ResizeObserver only reports on the next rendering step.
    const r = el.getBoundingClientRect()
    setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) })
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.max(1, width), h: Math.max(1, height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pixels per metre, world origin at the canvas centre, +y up.
  const ppm = size.h / VIEW_HEIGHT
  const toWorld = (sx: number, sy: number) => vec((sx - size.w / 2) / ppm, (size.h / 2 - sy) / ppm)

  const bounds: Bounds = useMemo(() => {
    const hw = size.w / ppm / 2 + TRACE_MARGIN
    const hh = VIEW_HEIGHT / 2 + TRACE_MARGIN
    return { minX: -hw, minY: -hh, maxX: hw, maxY: hh }
  }, [size.w, ppm])

  const lines = useMemo(() => computeFieldLines(dipoles, { ...DEFAULT_LINE_SET, bounds }), [dipoles, bounds])

  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size.w, size.h, lines, dipoles, selectedId, blockedId, screenTransform(size.w, size.h, ppm), ppm)
  }, [lines, dipoles, selectedId, blockedId, size, ppm, themeVersion])

  const pointerWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return toWorld(e.clientX - r.left, e.clientY - r.top)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const p = pointerWorld(e)
    // Larger targets for fingers than for a mouse.
    const touchPad = e.pointerType === 'touch' ? 2 : 1
    // Rotation handles first, so they win over the body they overlap.
    for (const d of [...dipoles].reverse()) {
      if (distance(p, handlePos(d)) < (12 * touchPad) / ppm) {
        setDrag({ kind: 'rotate', id: d.id })
        onSelect(d.id)
        canvasRef.current!.setPointerCapture(e.pointerId)
        return
      }
    }
    for (const d of [...dipoles].reverse()) {
      if (hitsBody(d, p, (4 * touchPad) / ppm)) {
        setDrag({ kind: 'move', id: d.id, grab: sub(p, d.position) })
        onSelect(d.id)
        canvasRef.current!.setPointerCapture(e.pointerId)
        return
      }
    }
    onSelect(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = pointerWorld(e)
    const d = dipoles.find((x) => x.id === drag.id)
    if (!d) return
    if (drag.kind === 'move') {
      onMove(d.id, sub(p, drag.grab))
    } else {
      const dir = sub(p, d.position)
      if (length(dir) > 1e-6) onRotate(d.id, Math.atan2(dir.y, dir.x))
    }
  }

  const endDrag = () => {
    setDrag(null)
    onDragEnd()
  }

  return (
    <canvas
      ref={canvasRef}
      className="field-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ cursor: drag ? 'grabbing' : 'default' }}
    />
  )
}

/** World (m, +y up) to canvas pixels, origin at the centre. */
const screenTransform = (w: number, h: number, ppm: number) => (p: Vec2) =>
  vec(w / 2 + p.x * ppm, h / 2 - p.y * ppm)

/** Rotation handle just beyond the north end. */
const handlePos = (d: Dipole) => add(d.position, scale(axisOf(d), bodyHalfLength(d) + d.coreRadius * 0.7))

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  lines: FieldLine[],
  dipoles: readonly Dipole[],
  selectedId: string | null,
  blockedId: string | null,
  toScreen: (p: Vec2) => Vec2,
  ppm: number,
) {
  const css = getComputedStyle(ctx.canvas)
  const color = (name: string) => css.getPropertyValue(name).trim()

  ctx.fillStyle = color('--canvas-bg')
  ctx.fillRect(0, 0, w, h)

  // Field lines
  ctx.strokeStyle = color('--field-line')
  ctx.fillStyle = color('--field-line')
  ctx.lineWidth = 1.25
  ctx.lineJoin = 'round'
  for (const line of lines) {
    const pts = line.points
    if (pts.length < 2) continue
    ctx.beginPath()
    const s0 = toScreen(pts[0])
    ctx.moveTo(s0.x, s0.y)
    for (let i = 1; i < pts.length; i++) {
      const s = toScreen(pts[i])
      ctx.lineTo(s.x, s.y)
    }
    ctx.stroke()
    drawArrow(ctx, line, toScreen)
  }

  // Magnets
  for (const d of dipoles) {
    const c = toScreen(d.position)
    const u = axisOf(d)
    const angle = -Math.atan2(u.y, u.x) // screen y is flipped
    const hl = bodyHalfLength(d) * ppm
    const hw = bodyHalfWidth(d) * ppm
    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.rotate(angle)
    ctx.fillStyle = color('--pole-south')
    ctx.fillRect(-hl, -hw, hl, 2 * hw)
    ctx.fillStyle = color('--pole-north')
    ctx.fillRect(0, -hw, hl, 2 * hw)
    const selected = d.id === selectedId
    ctx.lineWidth = selected ? 2.5 : 1
    ctx.strokeStyle = selected ? color('--selected') : color('--magnet-outline')
    ctx.strokeRect(-hl, -hw, 2 * hl, 2 * hw)
    if (d.id === blockedId) {
      // Dashed warning outline round a magnet whose move was just limited.
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 2
      ctx.strokeStyle = color('--blocked')
      const pad = 6
      ctx.strokeRect(-hl - pad, -hw - pad, 2 * (hl + pad), 2 * (hw + pad))
      ctx.setLineDash([])
    }
    ctx.fillStyle = '#fff'
    ctx.font = `600 ${Math.max(9, hw)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('N', hl / 2, 0)
    ctx.fillText('S', -hl / 2, 0)
    ctx.restore()

    const hp = toScreen(handlePos(d))
    ctx.beginPath()
    ctx.arc(hp.x, hp.y, selected ? 6 : 4, 0, 2 * Math.PI)
    ctx.fillStyle = selected ? color('--selected') : color('--handle')
    ctx.fill()
  }
}

/** One arrowhead at the middle of the line, pointing along B. */
function drawArrow(ctx: CanvasRenderingContext2D, line: FieldLine, toScreen: (p: Vec2) => Vec2) {
  const pts = line.points
  if (pts.length < 8) return
  const i = Math.floor(pts.length / 2)
  const a = toScreen(pts[i - 1])
  const b = toScreen(pts[i + 1])
  // Lines traced against B store points opposite to B; flip their arrow.
  const dir = line.direction === -1 ? sub(a, b) : sub(b, a)
  const len = length(dir)
  if (len === 0) return
  const u = scale(dir, 1 / len)
  const tip = toScreen(pts[i])
  const size = 6
  const back = sub(tip, scale(u, size))
  const n = vec(-u.y, u.x)
  ctx.beginPath()
  ctx.moveTo(tip.x, tip.y)
  ctx.lineTo(back.x + n.x * size * 0.5, back.y + n.y * size * 0.5)
  ctx.lineTo(back.x - n.x * size * 0.5, back.y - n.y * size * 0.5)
  ctx.closePath()
  ctx.fill()
}
