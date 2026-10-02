/** 難度 */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** 一盤進行中的數獨 */
export type Game = {
  difficulty: Difficulty
  /** 題目，81 字元，`.` 為空格 */
  givens: string
  /** 目前盤面（含題目），81 字元 */
  cells: string
  /** 選取中的格子索引；沒有選取為 null */
  selected: number | null
}

declare module 'claude-code' {
  interface PluginState {
    sudoku: { game: Game | null }
  }
}
