export const PARTS = [
  { id: '3437', label: '2 × 2', length: 2 },
  { id: '3011', label: '2 × 4', length: 4 },
  { id: '2300', label: '2 × 6', length: 6 },
] as const

// Standard LDraw codes; the actual materials come from LDConfig.ldr.
export const COLORS = [
  { code: '4', label: '红色' },
  { code: '1', label: '蓝色' },
  { code: '14', label: '黄色' },
  { code: '2', label: '绿色' },
  { code: '15', label: '白色' },
  { code: '0', label: '黑色' },
] as const

export type Brick = {
  id: string
  part: string
  color: string
  x: number // DUPLO stud pitches; position is the brick body's center in X/Z.
  z: number
  layer: number // Bottom of brick; zero is the ground plane.
  rotation: number // Degrees about world +Y.
}

export const STUD_LDU = 40
export const BODY_LDU = 48
export const MM_PER_LDU = 0.4

export function exampleBricks(): Brick[] {
  return [
    { id: crypto.randomUUID(), part: '2300', color: '1', x: 0, z: 0, layer: 0, rotation: 0 },
    { id: crypto.randomUUID(), part: '3011', color: '14', x: -1, z: 0, layer: 1, rotation: 0 },
    { id: crypto.randomUUID(), part: '3437', color: '4', x: 2, z: 0, layer: 1, rotation: 0 },
    { id: crypto.randomUUID(), part: '3437', color: '2', x: -2, z: 0, layer: 2, rotation: 0 },
  ]
}
