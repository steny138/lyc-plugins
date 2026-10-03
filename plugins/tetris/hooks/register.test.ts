import { expect, mock, test } from 'claude-code/testing'
import { stubEngine, run, mountPane, board } from './test-support'
test('指令開啟自己的棋盤、下一塊與初始統計', async ($, on) => {
  stubEngine(on)
  mock.clock(on)
  expect((await run($)).text).toContain('已開啟')
  const ui = await mountPane($)
  const raster = await ui.find({ key: 'board' })
  expect(raster.props.columns).toBe(20)
  expect(raster.props.rows).toBe(20)
  expect(await board(ui)).toEqual(Array(20).fill('..........'))
  expect(await ui.find({ type: 'Text', text: /^下一塊：/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: '分數：0' })).text).toBe('分數：0')
  expect((await ui.find({ type: 'Text', text: '消行：0' })).text).toBe('消行：0')
  expect((await ui.find({ type: 'Text', text: '等級：0' })).text).toBe('等級：0')
})
