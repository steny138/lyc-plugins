import type { Game } from '../types'
import { coords, spawn } from './tetris'
/** 各形狀的顏色（0xRRGGBB），文字與圖片棋盤共用。 */
const COLORS: Record<Game['next'], number> = { I: 0x56cfe1, O: 0xffd166, T: 0xc77dff, S: 0x80ed99, Z: 0xff6b6b, J: 0x5390d9, L: 0xf4a261 }
/** 可見區的格子：`x,y` 對應形狀，含活動方塊；`active` 為活動方塊的格子。 */
const occupied = (game: Game) => {
  const cells = { ...game.board }
  const active = new Set(coords(game.block).map(([x, y]) => `${x},${y}`))
  for (const [x, y] of coords(game.block)) cells[`${x},${y}`] = game.block.shape
  return { cells, active }
}
/** 每格兩個單寬字元：固定方塊 █、活動方塊 ▓（同形狀色），空格左半為暗色 ·；以 little-endian 編碼 Raster triplets。 */
export const raster = (game: Game): string => {
  const { cells, active } = occupied(game)
  const bytes = new Uint8Array(20 * 20 * 12)
  const data = new DataView(bytes.buffer)
  for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) {
    const key = `${Math.floor(col / 2) + 1},${20 - row}`
    const shape = cells[key]
    const offset = (row * 20 + col) * 12
    data.setUint32(offset, shape ? (active.has(key) ? 0x2593 : 0x2588) : col % 2 ? 0x20 : 0xb7, true)
    data.setUint32(offset + 4, shape ? COLORS[shape] : 0x39404d, true)
    data.setUint32(offset + 8, 0x01000000, true)
  }
  return bytes.toBase64()
}
/** 圖片棋盤每格的像素邊長；10×20 格為 80×160，畫進 20 欄 × 20 列時每格約為正方形。 */
const BLOCK_PX = 8
/** 空格底色與格線色。 */
const EMPTY = 0x161a20
const GRID = 0x242a33
/** 把顏色往白（amount > 0）或黑（amount < 0）混合 |amount|。 */
const shade = (color: number, amount: number) => {
  const target = amount > 0 ? 255 : 0
  const mix = (c: number) => Math.round(c + (target - c) * Math.abs(amount))
  return (mix(color >> 16) << 16) | (mix((color >> 8) & 0xff) << 8) | mix(color & 0xff)
}
/** 活動方塊整體提亮，與固定方塊區分（對應文字棋盤的 ▓／█）。 */
const ACTIVE_TINT = 0.3
/** 立體方塊的 RGBA 像素：上、左緣亮邊，下、右緣暗邊；空格為暗底與格線。回傳值即 Image 的 `{ rgba }` 來源。 */
export const pixels = (game: Game): { rgba: string; width: number; height: number } => {
  const { cells, active } = occupied(game)
  const width = 10 * BLOCK_PX, height = 20 * BLOCK_PX
  const bytes = new Uint8Array(width * height * 4)
  for (let row = 0; row < 20; row++) for (let col = 0; col < 10; col++) {
    const key = `${col + 1},${20 - row}`
    const shape = cells[key]
    const base = shape ? (active.has(key) ? shade(COLORS[shape], ACTIVE_TINT) : COLORS[shape]) : EMPTY
    // 每格只需三色：亮緣、本色、暗緣（空格為底色與格線）
    const light = shape ? shade(base, 0.45) : base
    const dark = shape ? shade(base, -0.4) : GRID
    for (let py = 0; py < BLOCK_PX; py++) for (let px = 0; px < BLOCK_PX; px++) {
      const edge = py === BLOCK_PX - 1 || px === BLOCK_PX - 1
      const color = shape && (py === 0 || px === 0) ? light : edge ? dark : base
      const offset = ((row * BLOCK_PX + py) * width + col * BLOCK_PX + px) * 4
      bytes[offset] = color >> 16
      bytes[offset + 1] = (color >> 8) & 0xff
      bytes[offset + 2] = color & 0xff
      bytes[offset + 3] = 0xff
    }
  }
  return { rgba: bytes.toBase64(), width, height }
}
/** 預覽用原版出生形狀，與下一個生成方塊共用幾何。 */
export const preview = (shape: Game['next']): string => {
  const cells = coords(spawn(shape))
  const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y)
  const rows: string[] = []
  for (let y = Math.max(...ys); y >= Math.min(...ys); y--) {
    let row = ''
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) row += cells.some(([cx, cy]) => x === cx && y === cy) ? '██' : '  '
    rows.push(row)
  }
  return rows.join('\n')
}
