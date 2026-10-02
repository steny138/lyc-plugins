import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { LEVELS } from './register'
import { solve } from './sudoku'

/** 掛上引擎底層的假實作：指令、Pane 開關；回傳可調整的狀態 */
const stubEngine = (on: On) => {
  const env = { isOpen: false, isShown: true }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => {
    env.isOpen = true

    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => {
    env.isOpen = false

    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: env.isOpen ? [{ id: 'sudoku', title: '數獨', isShown: env.isShown, isFocused: false, isPlaced: true }] : [],
  }))

  return env
}

/** 模擬使用者在終端機輸入 /sudoku */
const RUN_COMMAND: CommandRunInput = {
  command: 'sudoku',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 160 },
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'sudoku',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'sudoku',
    props: {
      title: '數獨',
      isFocused: false,
      bodyColumns: 72,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })

type Ui = Awaited<ReturnType<typeof mountPane>>

/** 畫面上可以點的格子（空格與玩家填的格子） */
const cellButtons = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).filter(el => el.key?.startsWith('cell-'))

/**
 * 從畫面依序讀回 81 格：題目格是單一數字的 Text，其餘是 `cell-<i>` Button。
 * 回傳 `{ givens, cells }`，與 plugin 內的盤面同格式（`.` 為空格）。
 */
const cellElements = async (ui: Ui) => {
  const elements = (await ui.findAll({})).filter(
    el => (el.type === 'Text' && /^[1-9]$/.test(el.text)) || (el.type === 'Button' && el.key?.startsWith('cell-')),
  )
  expect(elements).toHaveLength(81)

  return elements
}

const readBoard = async (ui: Ui) => {
  const elements = await cellElements(ui)

  return {
    givens: elements.map(el => (el.type === 'Text' ? el.text : '.')).join(''),
    cells: elements.map(el => (el.type === 'Text' || el.text !== '·' ? el.text : '.')).join(''),
  }
}

describe('難度', () => {
  test('提示數：簡單 44、中等 35、困難 26', () => {
    expect([LEVELS.easy.clues, LEVELS.medium.clues, LEVELS.hard.clues]).toEqual([44, 35, 26])
  })
})

describe('pane', () => {
  test('指令開啟 Pane，出一題簡單題目並畫出盤面', async ($, on) => {
    stubEngine(on)

    const { text } = await $.command.run(RUN_COMMAND)
    expect(text).toContain('已開啟')

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '難度：簡單' })).toBeDefined()
    // 空格是可以點的 Button，key 對應格子索引
    const { givens } = await readBoard(ui)
    const blanks = [...givens].flatMap((ch, i) => (ch === '.' ? [`cell-${i}`] : []))
    expect((await cellButtons(ui)).map(el => el.key)).toEqual(blanks)
    expect(blanks).toHaveLength(81 - LEVELS.easy.clues)
  })

  test('Pane 看得到時再執行指令就關閉', async ($, on) => {
    const env = stubEngine(on)
    await $.command.run(RUN_COMMAND)

    const { text } = await $.command.run(RUN_COMMAND)
    expect(text).toContain('已關閉')
    expect(env.isOpen).toBe(false)
  })

  test('Pane 被其他分頁蓋住時執行指令會重新開啟', async ($, on) => {
    const env = stubEngine(on)
    await $.command.run(RUN_COMMAND)
    env.isShown = false

    const { text } = await $.command.run(RUN_COMMAND)
    expect(text).toContain('已開啟')
    expect(env.isOpen).toBe(true)
  })

  test('重新開啟沿用同一盤', async ($, on) => {
    const env = stubEngine(on)
    await $.command.run(RUN_COMMAND)
    const ui = await mountPane($)
    const first = await readBoard(ui)
    await ui.unmount()

    env.isOpen = false
    await $.command.run(RUN_COMMAND)
    expect(await readBoard(await mountPane($))).toEqual(first)
  })
})

/** 選取中的格子外層是藍底 Box */
const blueBoxes = async (ui: Ui) => (await ui.findAll({ type: 'Box' })).filter(el => el.props.backgroundColor === 'blue')

/** 開啟 Pane 並回傳畫面與第一個空格的索引 */
const openGame = async ($: Engine, on: On) => {
  const env = stubEngine(on)
  await $.command.run(RUN_COMMAND)
  const ui = await mountPane($)
  const { givens } = await readBoard(ui)

  return { env, ui, givens, blank: givens.indexOf('.') }
}

describe('填數', () => {
  test('點格子再按數字，該格顯示數字；清除後恢復空格', async ($, on) => {
    const { ui, blank } = await openGame($, on)

    await ui.press({ key: `cell-${blank}` })
    await ui.press({ key: 'digit-5' })
    expect((await readBoard(ui)).cells[blank]).toBe('5')

    await ui.press({ key: 'clear' })
    expect((await readBoard(ui)).cells[blank]).toBe('.')
  })

  test('還沒選格子時按數字，盤面不變', async ($, on) => {
    const { ui } = await openGame($, on)
    const before = await readBoard(ui)

    await ui.press({ key: 'digit-5' })
    expect(await readBoard(ui)).toEqual(before)
  })

  test('數字鍵與清除鍵有快捷鍵', async ($, on) => {
    const { ui } = await openGame($, on)

    for (let d = 1; d <= 9; d++) {
      expect((await ui.find({ type: 'Button', key: `digit-${d}` }))?.props.hotkey).toBe(String(d))
    }
    expect((await ui.find({ type: 'Button', key: 'clear' }))?.props.hotkey).toBe('x')
  })
})

describe('衝突', () => {
  test('填入與同列題目相同的數字：題目格變紅字、玩家格變紅底', async ($, on) => {
    const { ui, givens, blank } = await openGame($, on)
    const row = Math.floor(blank / 9)
    const given = Array.from({ length: 9 }, (_, c) => row * 9 + c).find(i => givens[i] !== '.')!

    await ui.press({ key: `cell-${blank}` })
    await ui.press({ key: `digit-${givens[given]}` })

    const elements = await cellElements(ui)
    expect(elements[given]!.props.color).toBe('red')
    const redBoxes = (await ui.findAll({ type: 'Box' })).filter(el => el.props.backgroundColor === 'red')
    expect(redBoxes).toHaveLength(1)
    expect(redBoxes[0]!.children).toMatchObject([{ type: 'Button', props: { key: `cell-${blank}` } }])
  })
})

describe('完成', () => {
  test('狀態列顯示已填格數；照解答填完顯示完成，之後數字鍵不再作用', async ($, on) => {
    const { ui, givens, blank } = await openGame($, on)
    const blanks = [...givens].flatMap((ch, i) => (ch === '.' ? [i] : []))
    expect(await ui.find({ type: 'Text', text: `已填 0／${blanks.length}` })).toBeDefined()

    const solution = solve(givens)!
    for (const i of blanks) {
      await ui.press({ key: `cell-${i}` })
      await ui.press({ key: `digit-${solution[i]}` })
    }
    expect(await ui.find({ type: 'Text', text: '完成！' })).toBeDefined()

    const other = solution[blank] === '1' ? '2' : '1'
    await ui.press({ key: `cell-${blank}` })
    // 完成後不能再選取格子
    expect(await blueBoxes(ui)).toHaveLength(0)
    await ui.press({ key: `digit-${other}` })
    await ui.press({ key: 'clear' })
    expect((await readBoard(ui)).cells).toBe(solution)
  })
})

describe('新局', () => {
  for (const [difficulty, { label, hotkey, clues }] of Object.entries(LEVELS)) {
    const key = `new-${difficulty}`

    test(`按「${label}」換一題${label}題目並清除選取`, async ($, on) => {
      const { ui, givens, blank } = await openGame($, on)
      expect((await ui.find({ type: 'Button', key }))?.props.hotkey).toBe(hotkey)
      await ui.press({ key: `cell-${blank}` })

      await ui.press({ key })
      expect((await readBoard(ui)).givens).not.toBe(givens)
      expect(await ui.find({ type: 'Text', text: `難度：${label}` })).toBeDefined()
      expect(await cellButtons(ui)).toHaveLength(81 - clues)
      expect(await blueBoxes(ui)).toHaveLength(0)
    })
  }
})
