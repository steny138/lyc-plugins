import { describe, expect, test } from 'claude-code/testing'

import { conflicts, generate, isComplete, isUnique, solve } from './sudoku.ts'

// Project Euler 第 96 題的第一題與其解答
const EULER_1 = '..3.2.6..9..3.5..1..18.64....81.29..7.......8..67.82....26.95..8..2.3..9..5.1.3..'
const EULER_1_SOLUTION = '483921657967345821251876493548132976729564138136798245372689514814253769695417382'

/** 固定種子的亂數（mulberry32），讓出題測試可以重現 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('solve', () => {
  test('解出已知題目', () => {
    expect(solve(EULER_1)).toBe(EULER_1_SOLUTION)
  })

  test('題目自相矛盾時回傳 null', () => {
    expect(solve(`11${'.'.repeat(79)}`)).toBeNull()
  })
})

describe('isUnique', () => {
  test('已知題目只有一個解', () => {
    expect(isUnique(EULER_1)).toBe(true)
  })

  test('只給第一列時有多個解', () => {
    expect(isUnique(EULER_1_SOLUTION.slice(0, 9) + '.'.repeat(72))).toBe(false)
  })

  test('無解不算唯一解', () => {
    expect(isUnique(`11${'.'.repeat(79)}`)).toBe(false)
  })
})

describe('generate', () => {
  // 代表性的提示數，與難度設定無關；26 是目前最難一級，也確認出題夠快
  for (const clues of [60, 40, 26]) {
    test(`${clues} 個提示：提示數正確、唯一解、題目是解答的一部分`, () => {
      for (const seed of [1, 2, 3]) {
        const { puzzle, solution } = generate(clues, seeded(seed))

        expect(puzzle.replaceAll('.', '')).toHaveLength(clues)
        expect(isUnique(puzzle)).toBe(true)
        expect(solve(puzzle)).toBe(solution)
        expect([...puzzle].every((ch, i) => ch === '.' || ch === solution[i])).toBe(true)
      }
    })
  }
})

/** 空盤面上指定格子填入數字 */
const boardWith = (placed: Record<number, string>) =>
  Array.from({ length: 81 }, (_, i) => placed[i] ?? '.').join('')

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b)

describe('conflicts', () => {
  test('同一列重複', () => {
    expect(sorted(conflicts(boardWith({ 0: '5', 8: '5', 12: '5' })))).toEqual([0, 8])
  })

  test('同一行重複', () => {
    expect(sorted(conflicts(boardWith({ 4: '7', 76: '7' })))).toEqual([4, 76])
  })

  test('同一宮重複', () => {
    expect(sorted(conflicts(boardWith({ 30: '2', 50: '2' })))).toEqual([30, 50])
  })

  test('沒有重複時為空', () => {
    expect(conflicts(EULER_1).size).toBe(0)
    expect(conflicts(EULER_1_SOLUTION).size).toBe(0)
  })
})

describe('isComplete', () => {
  test('填滿且沒有衝突才算完成', () => {
    expect(isComplete(EULER_1_SOLUTION)).toBe(true)
    // 還有空格
    expect(isComplete(EULER_1)).toBe(false)
    // 填滿但第一列前兩格對調後與同行衝突
    expect(isComplete(`84${EULER_1_SOLUTION.slice(2)}`)).toBe(false)
  })
})
