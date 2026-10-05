/**
 * 數獨解題與出題，純函式，不碰引擎。
 *
 * 演算法改寫自 robatron/sudoku.js（https://github.com/robatron/sudoku.js）：
 * Peter Norvig 的約束傳播加上 DFS。原專案授權如下：
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2014 Rob McGuire-Dale
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

/** 盤面是 81 字元字串：`1`–`9` 為數字、`.` 為空格；索引 = 列 × 9 + 行 */
export const BLANK = '.'
const SIZE = 81
/** 九個數字全部可能的候選位元 */
const ALL = 0x1ff

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

/** 27 個單位：9 列、9 行、9 宮 */
const UNITS: number[][] = [
  ...range(9).map(r => range(9).map(c => r * 9 + c)),
  ...range(9).map(c => range(9).map(r => r * 9 + c)),
  ...range(9).map(b =>
    range(9).map(k => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3)),
  ),
]
/** 每格所屬的 3 個單位 */
const UNITS_OF = range(SIZE).map(i => UNITS.filter(unit => unit.includes(i)))
/** 每格的 20 個同儕：同列、同行、同宮，不含自己 */
const PEERS = range(SIZE).map(i => [...new Set(UNITS_OF[i]!.flat())].filter(j => j !== i))

/** 每格一個 9 位元遮罩，第 d-1 位代表數字 d 仍是候選 */
type Candidates = number[]

const bit = (d: number) => 1 << (d - 1)
const digitsOf = (mask: number) => range(9).filter(k => mask & (1 << k)).map(k => k + 1)
const countOf = (mask: number) => digitsOf(mask).length

/** 每格都還有九個候選的空候選表 */
const fullCandidates = (): Candidates => Array(SIZE).fill(ALL)
/** 每格都只剩一個候選時，轉回盤面字串 */
const toBoard = (cands: Candidates) => cands.map(mask => digitsOf(mask)[0]).join('')

/** 從格子 i 刪掉候選 d 並傳播；出現矛盾回傳 false（會直接修改 cands） */
const eliminate = (cands: Candidates, i: number, d: number): boolean => {
  if (!(cands[i]! & bit(d))) return true
  cands[i] = cands[i]! & ~bit(d)
  const left = cands[i]!
  if (left === 0) return false
  // 只剩一個候選：它不能再出現在同儕
  if (countOf(left) === 1) {
    const only = digitsOf(left)[0]!
    for (const peer of PEERS[i]!) if (!eliminate(cands, peer, only)) return false
  }
  // 某單位裡 d 只剩一個位置：就填在那裡
  for (const unit of UNITS_OF[i]!) {
    const places = unit.filter(j => cands[j]! & bit(d))
    if (places.length === 0) return false
    if (places.length === 1 && !assign(cands, places[0]!, d)) return false
  }

  return true
}

/** 格子 i 只留下候選 d 並傳播；出現矛盾回傳 false（會直接修改 cands） */
const assign = (cands: Candidates, i: number, d: number): boolean =>
  digitsOf(cands[i]! & ~bit(d)).every(other => eliminate(cands, i, other))

const candidatesOf = (board: string): Candidates | null => {
  if (!/^[1-9.]{81}$/.test(board)) throw new Error(`盤面格式錯誤：${board}`)
  const cands = fullCandidates()
  for (let i = 0; i < SIZE; i++) {
    const ch = board[i]!
    if (ch !== BLANK && !assign(cands, i, Number(ch))) return null
  }

  return cands
}

/** 從候選最少的格子開始逐一嘗試；`reverse` 時倒著試，用來檢查是否唯一解 */
const search = (cands: Candidates, reverse: boolean): Candidates | null => {
  let target = -1
  for (let i = 0; i < SIZE; i++) {
    const n = countOf(cands[i]!)
    if (n > 1 && (target === -1 || n < countOf(cands[target]!))) target = i
  }
  if (target === -1) return cands

  const digits = digitsOf(cands[target]!)
  if (reverse) digits.reverse()
  for (const d of digits) {
    const next = cands.slice()
    if (assign(next, target, d)) {
      const solved = search(next, reverse)
      if (solved) return solved
    }
  }

  return null
}

/** 解出盤面；無解回傳 null */
export const solve = (board: string, reverse = false): string | null => {
  const cands = candidatesOf(board)
  const solved = cands && search(cands, reverse)

  return solved ? toBoard(solved) : null
}

/**
 * 是否恰好一個解：正著與倒著搜尋走同一棵樹，有兩個以上解時第一個與最後一個必不同
 */
export const isUnique = (board: string): boolean => {
  const first = solve(board)

  return first !== null && first === solve(board, true)
}

/** Fisher–Yates 洗牌，回傳新陣列 */
const shuffle = <T>(items: readonly T[], rng: () => number): T[] => {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }

  return out
}

/** 隨機產生一個完整的解答：逐格隨機填入候選並傳播，矛盾就整輪重來 */
const randomSolution = (rng: () => number): string => {
  for (;;) {
    const cands = fullCandidates()
    const filled = shuffle(range(SIZE), rng).every(i => {
      const options = digitsOf(cands[i]!)

      return assign(cands, i, options[Math.floor(rng() * options.length)]!)
    })
    if (filled) return toBoard(cands)
  }
}

/**
 * 出一題恰好 `clues` 個提示、只有唯一解的題目。
 *
 * 從完整解答隨機逐格挖洞，挖掉後不再唯一就填回去；所有格子都試過仍挖不到
 * `clues` 就換一個解答重來。（原專案是一次留下 `clues` 個提示再檢查，
 * 提示少時幾乎都不唯一，困難題要十幾秒。）
 */
export const generate = (clues: number, rng: () => number = Math.random): { puzzle: string; solution: string } => {
  for (;;) {
    const solution = randomSolution(rng)
    const cells = [...solution]
    let left = SIZE
    for (const i of shuffle(range(SIZE), rng)) {
      if (left === clues) break
      cells[i] = BLANK
      if (isUnique(cells.join(''))) left--
      else cells[i] = solution[i]!
    }
    if (left === clues) return { puzzle: cells.join(''), solution }
  }
}

/** 同一列、同一行或同一宮有相同數字的格子（空格不算） */
export const conflicts = (cells: string): Set<number> => {
  const found = new Set<number>()
  for (const unit of UNITS) {
    for (const i of unit) {
      if (cells[i] !== BLANK && unit.some(j => j !== i && cells[j] === cells[i])) found.add(i)
    }
  }

  return found
}

/** 填滿且沒有衝突：題目唯一解，所以這時一定等於解答 */
export const isComplete = (cells: string): boolean => !cells.includes(BLANK) && conflicts(cells).size === 0
