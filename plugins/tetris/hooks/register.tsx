import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { newGame, move, rotate, tick, interval, drop } from './tetris'
import { raster } from './render'
const game = atom({ plugin: 'tetris', key: 'game' } as const, null)
let timer: { cancel: () => void } | undefined
let generation = 0
/** 單一排程；取消後舊 callback 不能繼續寫入或排下一次。 */
const schedule = ($: EngineInterface, delay: number) => {
  const token = ++generation
  timer?.cancel()
  timer = $.clock.after(delay, async () => {
    if (token !== generation) return
    await update($, game, prev => token === generation && prev ? tick(prev) : prev)
    if (token !== generation) return
    const current = await read($, game)
    if (current && !current.paused) schedule($, interval(current.level))
  })
}
const stop = () => { generation++; timer?.cancel(); timer = undefined }
const pause = async ($: EngineInterface) => {
  await update($, game, prev => prev && !prev.locked ? { ...prev, paused: !prev.paused } : prev)
  const current = await read($, game)
  if (!current || current.locked) return
  stop()
  if (!current.paused) schedule($, interval(current.level))
}
const restart = async ($: EngineInterface) => {
  const seed = await $.clock.now()
  stop()
  await update($, game, prev => ({ ...newGame(seed), paused: prev?.paused ?? false }))
  const current = await read($, game)
  if (current && !current.paused) schedule($, interval(current.level))
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => { await $.command.register({ name: 'tetris', description: '開關俄羅斯方塊面板' }); return next(e) })
  on('command.run', { command: 'tetris' }, async $ => {
    const seed = await $.clock.now()
    await update($, game, prev => prev ?? newGame(seed))
    if (!timer) schedule($, 0)
    await $.ui.open({ id: 'tetris', title: '俄羅斯方塊', columns: 48, rows: 32 })
    return { text: '俄羅斯方塊面板已開啟。' }
  })
  on('ui.render', { component: 'Pane', requestId: 'tetris' }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text>請在 Claude Code CLI 終端開啟 /tetris 遊玩。</Text>
    }
    const { Box, Text, Raster, Button } = $.ui.resolve(e)
    const current = await read($, game)
    if (!current) return <Text>輸入 /tetris 開始</Text>
    return <Box flexDirection="column">
      <Raster key="board" columns={20} rows={20} cells={raster(current)} />
      <Box>
        <Button key="left" label="左 A" hotkey="a" onPress={() => update($, game, prev => prev ? move(prev, 'left') : prev)} />
        <Button key="right" label="右 D" hotkey="d" onPress={() => update($, game, prev => prev ? move(prev, 'right') : prev)} />
        <Button key="down" label="下 S" hotkey="s" onPress={() => update($, game, prev => prev ? move(prev, 'down') : prev)} />
        <Button key="rotate" label="旋轉 W" hotkey="w" onPress={() => update($, game, prev => prev ? rotate(prev) : prev)} />
      </Box>
      <Button key="drop" label="落底 F" hotkey="f" onPress={() => update($, game, prev => prev ? drop(prev) : prev)} />
      <Button key="pause" label={current.paused ? "繼續 P" : "暫停 P"} hotkey="p" onPress={() => pause($)} />
      <Button key="restart" label="重新開始 R" hotkey="r" onPress={() => restart($)} />
      <Text>{current.paused ? '已暫停' : current.locked ? '正在固定（下一 tick）' : '遊戲中'}</Text>
      <Text key="next">{`下一塊：${current.next}`}</Text>
      <Text key="score">{`分數：${current.score}`}</Text>
      <Text key="lines">{`消行：${current.lines}`}</Text>
      <Text key="level">{`等級：${current.level}`}</Text>
    </Box>
  })
}
