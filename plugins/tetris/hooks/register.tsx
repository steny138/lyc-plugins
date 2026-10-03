import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { newGame } from './tetris'
import { raster } from './render'
const game = atom({ plugin: 'tetris', key: 'game' } as const, null)
export const register: Register = on => {
  on('session.start', async ($, e, next) => { await $.command.register({ name: 'tetris', description: '開關俄羅斯方塊面板' }); return next(e) })
  on('command.run', { command: 'tetris' }, async $ => {
    const seed = await $.clock.now()
    await update($, game, prev => prev ?? newGame(seed))
    await $.ui.open({ id: 'tetris', title: '俄羅斯方塊', columns: 48, rows: 32 })
    return { text: '俄羅斯方塊面板已開啟。' }
  })
  on('ui.render', { component: 'Pane', requestId: 'tetris' }, async ($, e) => {
    const { Box, Text, Raster } = $.ui.resolve(e)
    const current = await read($, game)
    if (!current) return <Text>輸入 /tetris 開始</Text>
    return <Box flexDirection="column">
      <Raster key="board" columns={20} rows={20} cells={raster(current)} />
      <Text key="next">{`下一塊：${current.next}`}</Text>
      <Text key="score">{`分數：${current.score}`}</Text>
      <Text key="lines">{`消行：${current.lines}`}</Text>
      <Text key="level">{`等級：${current.level}`}</Text>
    </Box>
  })
}
