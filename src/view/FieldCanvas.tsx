import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { bodyHalfLength, bodyHalfWidth, hitsBody } from '../model/magnetShape'
import { pairKey, SIM, type Bounds as SimBounds, type PairPhase } from '../model/simulation'
import { axisOf, type Dipole } from '../physics/dipole'
import { computeFieldLines, DEFAULT_LINE_SET, lineIntensities, type Bounds, type FieldLine } from '../physics/fieldLines'
import { interactionLevel, pairInteraction, polePairing, type NetLoad } from '../physics/interaction'
import { add, distance, length, scale, sub, vec, type Vec2 } from '../physics/vec2'

/** World height (m) shown at minimum, and minimum world width (m) on narrow screens. */
export const VIEW_HEIGHT = 3
const MIN_VIEW_WIDTH = 2.6
/** Extra world margin beyond the visible area where lines keep being traced. */
const TRACE_MARGIN = 0.5
/** Arc length between direction arrows on a field line (m). */
const ARROW_SPACING = 0.45
/** Strength buckets for shading lines: width and opacity rise with |B|. */
const BUCKETS = [
  { width: 0.9, alpha: 0.28 },
  { width: 1.2, alpha: 0.45 },
  { width: 1.6, alpha: 0.7 },
  { width: 2.1, alpha: 0.95 },
] as const
/** Flow overlay: dash pattern (px) and speed (px/s). */
const FLOW_DASH = [3, 15]
const FLOW_SPEED = 26
const PULSE_MS = 750

export interface Pulse {
  id: number
  at: Vec2
  kind: 'attach' | 'detach' | 'repel' | 'attract'
  start: number
}

interface Props {
  dipoles: readonly Dipole[]
  loads: readonly NetLoad[]
  attached: readonly string[]
  phases: Readonly<Record<string, PairPhase>>
  selectedId: string | null
  /** Magnet held by the pointer, its requested centre, and whether it is blocked or held by an attachment. */
  heldId: string | null
  dragTarget: Vec2 | null
  blocked: boolean
  holding: boolean
  showField: boolean
  showForces: boolean
  /** Flowing field lines and expanding pulses; off for reduced motion. */
  animate: boolean
  pulses: readonly Pulse[]
  /** Short labels drawn next to each magnet, matching the panel. */
  labels: Readonly<Record<string, string>>
  onSelect: (id: string | null) => void
  onDragStart: (id: string, mode: 'move' | 'rotate') => void
  /** Requested magnet centre for a move drag (pointer minus grab offset). */
  onDragMove: (id: string, target: Vec2) => void
  onRotateTo: (id: string, angle: number) => void
  onDragEnd: () => void
  onViewport: (bounds: SimBounds) => void
  /** Any pointer press on the canvas; used to unlock audio. */
  onGesture: () => void
}

type Drag = { kind: 'move'; id: string; grab: Vec2 } | { kind: 'rotate'; id: string }

interface View {
  w: number
  h: number
  ppm: number
}

const viewFor = (w: number, h: number): View => ({ w, h, ppm: Math.min(h / VIEW_HEIGHT, w / MIN_VIEW_WIDTH) })
const toScreen = (v: View) => (p: Vec2) => vec(v.w / 2 + p.x * v.ppm, v.h / 2 - p.y * v.ppm)
const toWorld = (v: View, sx: number, sy: number) => vec((sx - v.w / 2) / v.ppm, (v.h / 2 - sy) / v.ppm)

/** Rotation handle just beyond the north end. */
const handlePos = (d: Dipole) => add(d.position, scale(axisOf(d), bodyHalfLength(d) + d.coreRadius * 0.7))

export function FieldCanvas(props: Props) {
  const { dipoles, showField, animate, pulses, onViewport } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>(() => viewFor(800, 600))
  const [drag, setDrag] = useState<Drag | null>(null)

  useLayoutEffect(() => {
    const el = canvasRef.current!
    const measure = (w: number, h: number) => setView(viewFor(Math.max(1, w), Math.max(1, h)))
    // Measure now; ResizeObserver only reports on the next rendering step.
    const r = el.getBoundingClientRect()
    measure(r.width, r.height)
    const ro = new ResizeObserver(([entry]) => measure(entry.contentRect.width, entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    onViewport({ halfWidth: view.w / view.ppm / 2, halfHeight: view.h / view.ppm / 2 })
  }, [view, onViewport])

  const traceBounds: Bounds = useMemo(() => {
    const hw = view.w / view.ppm / 2 + TRACE_MARGIN
    const hh = view.h / view.ppm / 2 + TRACE_MARGIN
    return { minX: -hw, minY: -hh, maxX: hw, maxY: hh }
  }, [view])

  const lines = useMemo(
    () => (showField ? computeFieldLines(dipoles, { ...DEFAULT_LINE_SET, bounds: traceBounds }) : []),
    [dipoles, traceBounds, showField],
  )
  const shades = useMemo(() => lineIntensities(lines, dipoles, DEFAULT_LINE_SET.softening), [lines, dipoles])
  const paths = useMemo(() => buildPaths(lines, shades, view), [lines, shades, view])

  // Latest inputs for the draw function, which may run from an animation frame.
  const latest = useRef({ props, view, paths })
  useLayoutEffect(() => {
    latest.current = { props, view, paths }
  })

  // Draw once per change; run a frame loop only while something animates.
  useEffect(() => {
    const canvas = canvasRef.current!
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(view.w * dpr)
    canvas.height = Math.round(view.h * dpr)
    const ctx = canvas.getContext('2d')!
    let raf: number | null = null
    const needsLoop = (t: number) => (animate && showField) || pulses.some((p) => t - p.start < PULSE_MS)
    const loop = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw(ctx, t, latest.current)
      raf = needsLoop(t) ? requestAnimationFrame(loop) : null
    }
    loop(performance.now())
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [
    props.dipoles,
    props.loads,
    props.attached,
    props.phases,
    props.selectedId,
    props.heldId,
    props.dragTarget,
    props.blocked,
    props.holding,
    props.showForces,
    props.labels,
    showField,
    animate,
    pulses,
    view,
    paths,
  ])

  const pointerWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return toWorld(view, e.clientX - r.left, e.clientY - r.top)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    props.onGesture()
    const p = pointerWorld(e)
    // Larger targets for fingers than for a mouse.
    const touchPad = e.pointerType === 'touch' ? 2 : 1
    const capture = () => {
      try {
        canvasRef.current!.setPointerCapture(e.pointerId)
      } catch {
        // Synthetic or already-released pointers cannot be captured; dragging still works.
      }
    }
    // Rotation handles first, so they win over the body they overlap.
    for (const d of [...dipoles].reverse()) {
      if (distance(p, handlePos(d)) < (14 * touchPad) / view.ppm) {
        setDrag({ kind: 'rotate', id: d.id })
        props.onSelect(d.id)
        props.onDragStart(d.id, 'rotate')
        capture()
        return
      }
    }
    for (const d of [...dipoles].reverse()) {
      if (hitsBody(d, p, (5 * touchPad) / view.ppm)) {
        setDrag({ kind: 'move', id: d.id, grab: sub(p, d.position) })
        props.onSelect(d.id)
        props.onDragStart(d.id, 'move')
        capture()
        return
      }
    }
    props.onSelect(null)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = pointerWorld(e)
    const d = dipoles.find((x) => x.id === drag.id)
    if (!d) return
    if (drag.kind === 'move') props.onDragMove(d.id, sub(p, drag.grab))
    else {
      const dir = sub(p, d.position)
      if (length(dir) > 1e-6) props.onRotateTo(d.id, Math.atan2(dir.y, dir.x))
    }
  }

  const endDrag = () => {
    if (!drag) return
    setDrag(null)
    props.onDragEnd()
  }

  return (
    <canvas
      ref={canvasRef}
      className="field-canvas"
      role="img"
      aria-label={`Magnetic field simulation with ${dipoles.length} magnet${dipoles.length === 1 ? '' : 's'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      style={{ cursor: drag ? 'grabbing' : 'default' }}
    />
  )
}

interface LinePaths {
  /** One path per strength bucket for the base lines. */
  base: Path2D[]
  /** Flow overlay paths per bucket, split by whether points run along (+1) or against (−1) B. */
  flow: { forward: Path2D; backward: Path2D }[]
  arrows: { x: number; y: number; angle: number; bucket: number }[]
}

const bucketOf = (t: number) => Math.min(BUCKETS.length - 1, Math.floor(t * BUCKETS.length))

/** Screen-space paths grouped by strength, built once per line set and view. */
function buildPaths(lines: readonly FieldLine[], shades: readonly number[][], view: View): LinePaths {
  const S = toScreen(view)
  const base = BUCKETS.map(() => new Path2D())
  const flow = BUCKETS.map(() => ({ forward: new Path2D(), backward: new Path2D() }))
  const arrows: LinePaths['arrows'] = []
  lines.forEach((line, li) => {
    const pts = line.points
    if (pts.length < 2) return
    let prev = S(pts[0])
    // A new subpath starts at the beginning of each line and wherever the bucket changes.
    let prevBucket = -1
    let arc = 0
    let nextArrow = ARROW_SPACING / 2
    for (let i = 1; i < pts.length; i++) {
      const cur = S(pts[i])
      const b = bucketOf((shades[li][i - 1] + shades[li][i]) / 2)
      const target = line.direction === 1 ? flow[b].forward : flow[b].backward
      if (b !== prevBucket) {
        base[b].moveTo(prev.x, prev.y)
        target.moveTo(prev.x, prev.y)
      }
      base[b].lineTo(cur.x, cur.y)
      target.lineTo(cur.x, cur.y)
      prevBucket = b
      arc += distance(pts[i - 1], pts[i])
      if (arc >= nextArrow) {
        nextArrow += ARROW_SPACING
        // Direction of B: points run against B when the line was traced backwards.
        const dir = line.direction === 1 ? sub(cur, prev) : sub(prev, cur)
        arrows.push({ x: cur.x, y: cur.y, angle: Math.atan2(dir.y, dir.x), bucket: b })
      }
      prev = cur
    }
  })
  return { base, flow, arrows }
}

interface DrawInput {
  props: Props
  view: View
  paths: LinePaths
}

function draw(ctx: CanvasRenderingContext2D, t: number, { props, view, paths }: DrawInput) {
  const css = getComputedStyle(ctx.canvas)
  const color = (name: string) => css.getPropertyValue(name).trim()
  const S = toScreen(view)
  const { w, h, ppm } = view

  ctx.fillStyle = color('--canvas-bg')
  ctx.fillRect(0, 0, w, h)
  drawGrid(ctx, view, color('--grid'), color('--muted'))

  if (props.showField) {
    const lineColor = color('--field-line')
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = lineColor
    BUCKETS.forEach((b, i) => {
      ctx.globalAlpha = b.alpha
      ctx.lineWidth = b.width
      ctx.stroke(paths.base[i])
    })
    if (props.animate) {
      // Bright dashes drift along B: forward paths run with B, backward ones against it.
      const phase = ((t / 1000) * FLOW_SPEED) % (FLOW_DASH[0] + FLOW_DASH[1])
      ctx.setLineDash(FLOW_DASH)
      ctx.strokeStyle = color('--field-flow')
      BUCKETS.forEach((b, i) => {
        ctx.globalAlpha = Math.min(1, b.alpha + 0.25)
        ctx.lineWidth = b.width + 0.6
        ctx.lineDashOffset = -phase
        ctx.stroke(paths.flow[i].forward)
        ctx.lineDashOffset = phase
        ctx.stroke(paths.flow[i].backward)
      })
      ctx.setLineDash([])
    }
    ctx.fillStyle = lineColor
    for (const a of paths.arrows) {
      ctx.globalAlpha = Math.min(1, BUCKETS[a.bucket].alpha + 0.2)
      arrowHead(ctx, a.x, a.y, a.angle, 4 + a.bucket)
    }
    ctx.globalAlpha = 1
  }

  drawInteractions(ctx, props, S, ppm, color)
  drawMagnets(ctx, props, S, ppm, color)
  if (props.showForces) drawForces(ctx, props, S, ppm, color('--force'))
  drawHeld(ctx, props, S, color)
  drawPulses(ctx, props, S, t, color)
}

/** Faint 25 cm grid and a 50 cm scale bar: positions are in (model) metres. */
function drawGrid(ctx: CanvasRenderingContext2D, view: View, grid: string, label: string) {
  const { w, h, ppm } = view
  const step = 0.25 * ppm
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = (w / 2) % step; x < w; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, h)
  }
  for (let y = (h / 2) % step; y < h; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(w, Math.round(y) + 0.5)
  }
  ctx.stroke()
  const bar = 0.5 * ppm
  const x0 = 16
  const y0 = h - 16
  ctx.strokeStyle = label
  ctx.fillStyle = label
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x0, y0 - 4)
  ctx.lineTo(x0, y0)
  ctx.lineTo(x0 + bar, y0)
  ctx.lineTo(x0 + bar, y0 - 4)
  ctx.stroke()
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'bottom'
  ctx.fillText('50 cm', x0 + 4, y0 - 4)
}

/** Soft glows between facing poles while a pair attracts (cyan) or repels (violet), scaled by strength. */
function drawInteractions(
  ctx: CanvasRenderingContext2D,
  props: Props,
  S: (p: Vec2) => Vec2,
  ppm: number,
  color: (n: string) => string,
) {
  const ds = props.dipoles
  for (let i = 0; i < ds.length; i++) {
    for (let j = i + 1; j < ds.length; j++) {
      const a = ds[i]
      const b = ds[j]
      const key = pairKey(a.id, b.id)
      const phase = props.phases[key] ?? 'none'
      const attached = props.attached.includes(key)
      if (phase === 'none' && !attached) continue
      const p = pairInteraction(a, b)
      const level = interactionLevel(p.magnitude, SIM.staticForce)
      const pairing = polePairing(a, b, bodyHalfLength(a), bodyHalfLength(b))
      const mid = S(scale(add(pairing.pointA, pairing.pointB), 0.5))
      const radius = (0.06 + 0.1 * level) * ppm
      const tone = attached || p.kind === 'attract' ? color('--attract') : color('--repel')
      const g = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, radius)
      g.addColorStop(0, withAlpha(tone, attached ? 0.55 : 0.25 + 0.45 * level))
      g.addColorStop(1, withAlpha(tone, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(mid.x, mid.y, radius, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}

function drawMagnets(
  ctx: CanvasRenderingContext2D,
  props: Props,
  S: (p: Vec2) => Vec2,
  ppm: number,
  color: (n: string) => string,
) {
  for (const d of props.dipoles) {
    const c = S(d.position)
    const u = axisOf(d)
    const angle = -Math.atan2(u.y, u.x) // screen y is flipped
    const hl = bodyHalfLength(d) * ppm
    const hw = bodyHalfWidth(d) * ppm
    const selected = d.id === props.selectedId

    if (selected) {
      ctx.strokeStyle = color('--accent')
      ctx.lineWidth = 1.5
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(c.x, c.y, hl + 10, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.save()
    ctx.translate(c.x, c.y)
    ctx.rotate(angle)
    ctx.fillStyle = color('--pole-south')
    ctx.fillRect(-hl, -hw, hl, 2 * hw)
    ctx.fillStyle = color('--pole-north')
    ctx.fillRect(0, -hw, hl, 2 * hw)
    ctx.lineWidth = selected ? 2 : 1
    ctx.strokeStyle = selected ? color('--accent') : color('--magnet-outline')
    ctx.strokeRect(-hl, -hw, 2 * hl, 2 * hw)
    if (d.id === props.heldId && props.blocked) {
      ctx.setLineDash([5, 4])
      ctx.lineWidth = 2
      ctx.strokeStyle = color('--blocked')
      ctx.strokeRect(-hl - 6, -hw - 6, 2 * (hl + 6), 2 * (hw + 6))
      ctx.setLineDash([])
    }
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.max(10, hw * 1.1)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // Keep the letters upright whatever the bar's angle.
    for (const [label, x] of [
      ['N', hl / 2],
      ['S', -hl / 2],
    ] as const) {
      ctx.save()
      ctx.translate(x, 0)
      ctx.rotate(-angle)
      ctx.fillText(label, 0, 1)
      ctx.restore()
    }
    ctx.restore()

    const hp = S(handlePos(d))
    ctx.beginPath()
    ctx.arc(hp.x, hp.y, selected ? 6 : 4, 0, 2 * Math.PI)
    ctx.fillStyle = selected ? color('--accent') : color('--handle')
    ctx.fill()

    const label = props.labels[d.id]
    if (label) {
      ctx.fillStyle = selected ? color('--accent') : color('--muted')
      ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.fillText(label, c.x, c.y - Math.max(hl, hw) - 12)
    }
  }
}

/** Net force arrows (length ∝ relative level, not newtons) and torque arcs. */
function drawForces(ctx: CanvasRenderingContext2D, props: Props, S: (p: Vec2) => Vec2, ppm: number, tone: string) {
  ctx.strokeStyle = tone
  ctx.fillStyle = tone
  ctx.lineWidth = 2
  props.dipoles.forEach((d, i) => {
    const load = props.loads[i]
    if (!load) return
    const c = S(d.position)
    const f = length(load.force)
    const level = interactionLevel(f, SIM.staticForce)
    if (level > 0.05) {
      const len = (0.08 + 0.3 * level) * ppm
      const dir = vec(load.force.x / f, -load.force.y / f)
      const tip = add(c, scale(dir, len))
      ctx.globalAlpha = 0.35 + 0.65 * level
      ctx.beginPath()
      ctx.moveTo(c.x, c.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.stroke()
      arrowHead(ctx, tip.x, tip.y, Math.atan2(dir.y, dir.x), 7)
    }
    const tl = interactionLevel(Math.abs(load.torque), SIM.staticTorque)
    if (tl > 0.1) {
      const r = bodyHalfLength(d) * ppm + 16
      const sweep = 0.4 + 1.2 * tl
      // Positive torque turns counter-clockwise in world space, which is anticlockwise on screen
      // too once y is flipped, so it sweeps towards smaller canvas angles.
      const ccw = load.torque > 0
      const start = -Math.PI / 2
      const end = ccw ? start - sweep : start + sweep
      ctx.globalAlpha = 0.3 + 0.6 * tl
      ctx.beginPath()
      ctx.arc(c.x, c.y, r, start, end, ccw)
      ctx.stroke()
      const tip = vec(c.x + r * Math.cos(end), c.y + r * Math.sin(end))
      arrowHead(ctx, tip.x, tip.y, end + (ccw ? -Math.PI / 2 : Math.PI / 2), 6)
    }
  })
  ctx.globalAlpha = 1
}

/** While dragging: a tether from the pointer to a magnet that is resisting or being pulled. */
function drawHeld(ctx: CanvasRenderingContext2D, props: Props, S: (p: Vec2) => Vec2, color: (n: string) => string) {
  if (!props.heldId || !props.dragTarget) return
  const d = props.dipoles.find((x) => x.id === props.heldId)
  if (!d || distance(d.position, props.dragTarget) < 0.01) return
  const a = S(d.position)
  const b = S(props.dragTarget)
  ctx.strokeStyle = props.holding ? color('--attract') : color('--muted')
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath()
  ctx.arc(b.x, b.y, 4, 0, 2 * Math.PI)
  ctx.stroke()
}

function drawPulses(ctx: CanvasRenderingContext2D, props: Props, S: (p: Vec2) => Vec2, t: number, color: (n: string) => string) {
  for (const p of props.pulses) {
    const age = (t - p.start) / PULSE_MS
    if (age < 0 || age >= 1) continue
    const c = S(p.at)
    const tone = p.kind === 'repel' ? color('--repel') : color('--attract')
    // Expanding ring, or a fixed one that fades when motion is reduced.
    const r = props.animate ? 8 + 34 * age : 18
    ctx.strokeStyle = withAlpha(tone, (1 - age) * 0.9)
    ctx.lineWidth = p.kind === 'attach' ? 2.5 : 1.5
    ctx.beginPath()
    ctx.arc(c.x, c.y, r, 0, 2 * Math.PI)
    ctx.stroke()
  }
}

function arrowHead(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number) {
  const ux = Math.cos(angle)
  const uy = Math.sin(angle)
  ctx.beginPath()
  ctx.moveTo(x + ux * size * 0.6, y + uy * size * 0.6)
  ctx.lineTo(x - ux * size * 0.6 - uy * size * 0.5, y - uy * size * 0.6 + ux * size * 0.5)
  ctx.lineTo(x - ux * size * 0.6 + uy * size * 0.5, y - uy * size * 0.6 - ux * size * 0.5)
  ctx.closePath()
  ctx.fill()
}

/** "#rrggbb" + alpha → rgba(); other colour formats pass through unchanged. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`
}
