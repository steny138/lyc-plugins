import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Difficulty, Game } from '../types'
import { BLANK, conflicts, generate, isComplete } from './sudoku'

const PANE = 'sudoku'
const TITLE = '數獨'
/** dock 時的寬度；inline 時的高度 */
const OPEN_ARGS = { id: PANE, title: TITLE, columns: 72, rows: 26 }

/** 各難度的名稱、新局快捷鍵與題目提示數；新局按鈕依這個順序排列 */
export const LEVELS: Record<Difficulty, { label: string; hotkey: string; clues: number }> = {
  easy: { label: '簡單', hotkey: 'e', clues: 44 },
  medium: { label: '中等', hotkey: 'm', clues: 35 },
  hard: { label: '困難', hotkey: 'h', clues: 26 },
}
const DIFFICULTIES = Object.keys(LEVELS) as Difficulty[]

/** 第 n 列（或行）之後是宮與宮的邊界 */
const isBoxEdge = (n: number) => n === 2 || n === 5

const game = atom({ plugin: 'sudoku', key: 'game' } as const, null)

const newGame = (difficulty: Difficulty): Game => {
  const { puzzle } = generate(LEVELS[difficulty].clues)

  return { difficulty, givens: puzzle, cells: puzzle, selected: null }
}

/** 選取一格（題目格不能選；完成後也不能選） */
const select = ($: EngineInterface, i: number) =>
  update($, game, prev =>
    prev && prev.givens[i] === BLANK && !isComplete(prev.cells) ? { ...prev, selected: i } : prev,
  )

/** 在選取的格子填入數字；`BLANK` 為清除。沒有選取或已完成時不變 */
const put = ($: EngineInterface, value: string) =>
  update($, game, prev => {
    if (prev === null || prev.selected === null || isComplete(prev.cells)) return prev
    const i = prev.selected

    const cells = prev.cells.slice(0, i) + value + prev.cells.slice(i + 1)

    // 填完就清掉選取，盤面不再能操作
    return { ...prev, cells, selected: isComplete(cells) ? null : i }
  })

/** Pane 開著、已畫在畫面上、且是目前顯示的分頁 */
const isPaneVisible = async ($: EngineInterface): Promise<boolean> =>
  (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sudoku', description: '開關數獨面板' })

    return next(e)
  })

  // 切換：看得到就關掉；否則打開，還沒有盤面就先出一題簡單
  on('command.run', { command: 'sudoku' }, async $ => {
    if (await isPaneVisible($)) {
      await $.ui.close({ id: PANE })

      return { text: '數獨面板已關閉。' }
    }
    await update($, game, prev => prev ?? newGame('easy'))
    await $.ui.open(OPEN_ARGS)

    return { text: '數獨面板已開啟。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, game)
    if (current === null) return <Text dimColor>輸入 /sudoku 開始</Text>

    const clashing = conflicts(current.cells)
    const open = [...current.givens].flatMap((ch, i) => (ch === BLANK ? [i] : []))
    const filled = open.filter(i => current.cells[i] !== BLANK).length
    const status = isComplete(current.cells) ? (
      <Text bold color="green">
        完成！
      </Text>
    ) : (
      <Text dimColor>{`已填 ${filled}／${open.length}`}</Text>
    )
    const cell = (i: number) => {
      if (current.givens[i] !== BLANK) {
        return (
          <Text bold color={clashing.has(i) ? 'red' : undefined}>
            {current.givens[i]}
          </Text>
        )
      }
      const button = (
        <Button
          key={`cell-${i}`}
          label={current.cells[i] === BLANK ? '·' : current.cells[i]!}
          plain
          onPress={() => void select($, i)}
        />
      )

      // 衝突優先於選取
      const background = clashing.has(i) ? 'red' : current.selected === i ? 'blue' : undefined

      return background ? <Box backgroundColor={background}>{button}</Box> : button
    }

    const row = (r: number) => (
      <Box>
        {Array.from({ length: 9 }, (_, c) => (
          <Box>
            {cell(r * 9 + c)}
            {isBoxEdge(c) ? <Text dimColor>{'  │  '}</Text> : c < 8 ? <Text>{'   '}</Text> : null}
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column" paddingTop={3} paddingLeft={15}>
        <Text dimColor>{`難度：${LEVELS[current.difficulty].label}`}</Text>
        <Box flexDirection="column" marginTop={1}>
          {Array.from({ length: 9 }, (_, r) => (
            <Box flexDirection="column">
              {row(r)}
              {isBoxEdge(r) ? <Text dimColor>{`${'─'.repeat(11)}┼${'─'.repeat(13)}┼${'─'.repeat(11)}`}</Text> : null}
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          {[0, 1, 2].map(r => (
            <Box gap={1}>
              {[1, 2, 3].map(c => {
                const d = String(r * 3 + c)

                return <Button key={`digit-${d}`} label={d} hotkey={d} onPress={() => void put($, d)} />
              })}
            </Box>
          ))}
          <Button key="clear" label="清除" hotkey="x" onPress={() => void put($, BLANK)} />
        </Box>
        <Box marginTop={1} gap={1}>
          {DIFFICULTIES.map(d => (
            <Button
              key={`new-${d}`}
              label={LEVELS[d].label}
              hotkey={LEVELS[d].hotkey}
              onPress={() => void update($, game, () => newGame(d))}
            />
          ))}
        </Box>
        <Box marginTop={1}>{status}</Box>
      </Box>
    )
  })
}
