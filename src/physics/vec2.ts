/** Immutable 2D vector helpers. All physics code works in world units (metres). */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

export const vec = (x: number, y: number): Vec2 => ({ x, y })
export const ZERO: Vec2 = vec(0, 0)

export const add = (a: Vec2, b: Vec2): Vec2 => vec(a.x + b.x, a.y + b.y)
export const sub = (a: Vec2, b: Vec2): Vec2 => vec(a.x - b.x, a.y - b.y)
export const scale = (a: Vec2, s: number): Vec2 => vec(a.x * s, a.y * s)
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const lengthSq = (a: Vec2): number => a.x * a.x + a.y * a.y
export const length = (a: Vec2): number => Math.hypot(a.x, a.y)
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)
export const isFiniteVec = (a: Vec2): boolean => Number.isFinite(a.x) && Number.isFinite(a.y)

/** Unit vector at `angle` radians from +x. */
export const fromAngle = (angle: number, len = 1): Vec2 => vec(Math.cos(angle) * len, Math.sin(angle) * len)

export const rotate = (a: Vec2, angle: number): Vec2 => {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return vec(a.x * c - a.y * s, a.x * s + a.y * c)
}
