import type { Game } from '../types'
import { coords } from './tetris'
/** 每格兩個單寬字元，明確以 little-endian 編碼 Raster triplets。 */
export const raster = (game: Game): string => {
  const cells = { ...game.board }
  for (const [x, y] of coords(game.block)) cells[`${x},${y}`] = game.block.shape
  const bytes = new Uint8Array(20 * 20 * 12)
  const data = new DataView(bytes.buffer)
  const colors = { I: 0x56cfe1, O: 0xffd166, T: 0xc77dff, S: 0x80ed99, Z: 0xff6b6b, J: 0x5390d9, L: 0xf4a261 }
  for (let row = 0; row < 20; row++) for (let col = 0; col < 20; col++) {
    const shape = cells[`${Math.floor(col / 2) + 1},${20 - row}`]
    const offset = (row * 20 + col) * 12
    data.setUint32(offset, shape ? shape.charCodeAt(0) : 46, true)
    data.setUint32(offset + 4, shape ? colors[shape] : 0x39404d, true)
    data.setUint32(offset + 8, 0x01000000, true)
  }
  return bytes.toBase64()
}
