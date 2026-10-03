/** 改寫自 samtay/tetris（MIT，Copyright (c) 2025 Sam Tay）；完整授權見 ../NOTICE.md。 */
import type { Block, Coord, Game, Shape } from '../types'
const SHAPES: Shape[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']
const CELLS: Record<Shape, Coord[]> = {
  I: [[-2, 0], [-1, 0], [1, 0]], O: [[-1, 0], [-1, -1], [0, -1]],
  T: [[-1, 0], [0, -1], [1, 0]], S: [[-1, -1], [0, -1], [1, 0]],
  Z: [[-1, 0], [0, -1], [1, -1]], J: [[-1, 0], [1, 0], [1, -1]], L: [[-1, -1], [-1, 0], [1, 0]],
}
export const spawn = (shape: Shape): Block => ({ shape, origin: [6, 22], extra: CELLS[shape].map(([x, y]) => [x + 6, y + 22]) })
export const coords = (block: Block): Coord[] => [block.origin, ...block.extra]
/** 以序列化亂數狀態抽袋；update 重試不會消耗外部亂數。 */
const draw = (bag: Shape[], random: number): [Shape, Shape[], number] => {
  if (!bag.length) {
    const pool = Array.from({ length: 28 }, (_, i) => SHAPES[i % 7]!)
    bag = []
    while (pool.length) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      bag.push(pool.splice(Math.floor(random / 4294967296 * pool.length), 1)[0]!)
    }
  }
  return [bag[0]!, bag.slice(1), random]
}
export const newGame = (seed: number): Game => {
  const [first, bag, random] = draw([], seed >>> 0)
  const [next, rest, state] = draw(bag, random)
  return { block: spawn(first), next, bag: rest, random: state, board: {}, score: 0, lines: 0, level: 0 }
}
