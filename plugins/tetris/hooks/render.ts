import type { Game } from '../types'
import { coords, spawn } from './tetris'
/** 每格兩個單寬字元，明確以 little-endian 編碼 Raster triplets。 */
export const raster = (game: Game): string => {
  const cells = { ...game.board }
  const active = new Set(coords(game.block).map(([x, y]) => `${x},${y}`))
  for (const [x, y] of coords(game.block)) cells[`${x},${y}`] = game.block.shape
  const bytes = new Uint8Array(20 * 20 * 12)
  const data = new DataView(bytes.buffer)
  const colors = { I: 0x56cfe1, O: 0xffd166, T: 0xc77dff, S: 0x80ed99, Z: 0xff6b6b, J: 0x5390d9, L: 0xf4a261 }
  for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) {
    const key = `${Math.floor(col / 2) + 1},${20 - row}`
    const shape = cells[key]
    const offset = (row * 20 + col) * 12
    data.setUint32(offset, shape ? shape.charCodeAt(0) : 46, true)
    data.setUint32(offset + 4, shape ? colors[shape] : 0x39404d, true)
    data.setUint32(offset + 8, active.has(key) ? 0x303c54 : 0x01000000, true)
  }
  return bytes.toBase64()
}
/** 預覽用原版出生形狀，與下一個生成方塊共用幾何。 */
export const preview = (shape: Game['next']): string => {
  const cells = coords(spawn(shape))
  const xs = cells.map(([x]) => x), ys = cells.map(([, y]) => y)
  const rows: string[] = []
  for (let y = Math.max(...ys); y >= Math.min(...ys); y--) {
    let row = ''
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) row += cells.some(([cx, cy]) => x === cx && y === cy) ? shape.repeat(2) : '  '
    rows.push(row)
  }
  return rows.join('\n')
}
