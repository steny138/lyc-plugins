import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { newGame, move, rotate, tick, interval, drop, isGameOver } from './tetris'
import { raster, preview } from './render'
const game = atom({ plugin: 'tetris', key: 'game' } as const, null)
let timer: { cancel: () => void } | undefined
let generation = 0
/** 排程綁定目前 session，切換 session 時不可沿用舊 callback。 */
let ownerSession: string | undefined
/** 單一排程；取消後舊 callback 不能繼續寫入或排下一次。 */
const schedule = ($: EngineInterface, delay: number) => {
  const token = ++generation
  const sessionId = ownerSession
  timer?.cancel()
  timer = $.clock.after(delay, async () => {
    if (token !== generation) return
    if (await $.session.id() !== sessionId) { if (token === generation) stop(); return }
    if (token !== generation) return
    await update($, game, prev => token === generation && prev ? tick(prev) : prev)
    if (token !== generation) return
    const current = await read($, game)
    if (current && !current.paused && !isGameOver(current)) schedule($, interval(current.level))
  })
}
const stop = () => { generation++; timer?.cancel(); timer = undefined }
const pause = async ($: EngineInterface) => {
  await update($, game, prev => prev && !prev.locked && !isGameOver(prev) ? { ...prev, paused: !prev.paused } : prev)
  const current = await read($, game)
  if (!current || current.locked || isGameOver(current)) return
  stop()
  if (!current.paused) schedule($, interval(current.level))
}
const restart = async ($: EngineInterface) => {
  const seed = await $.clock.now()
  stop()
  await update($, game, prev => ({ ...newGame(seed), paused: prev?.paused ?? false }))
  const current = await read($, game)
  if (current && !current.paused && !isGameOver(current)) schedule($, interval(current.level))
}
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    stop()
    ownerSession = await $.session.id()
    await $.command.register({ name: 'tetris', description: '開關俄羅斯方塊面板' })
    const current = await read($, game)
    if (current && !current.paused && !isGameOver(current)) schedule($, interval(current.level))
    return next(e)
  })
  on('session.end', (_$, e, next) => { stop(); return next(e) })
  on('command.run', { command: 'tetris' }, async $ => {
    const sessionId = await $.session.id()
    if (ownerSession !== sessionId) stop()
    ownerSession = sessionId
    if ((await $.ui.panes()).some(pane => pane.id === 'tetris' && pane.isPlaced && pane.isShown)) {
      await $.ui.close({ id: 'tetris' })
      return { text: '俄羅斯方塊面板已關閉。' }
    }
    const seed = await $.clock.now()
    const existed = await read($, game)
    await update($, game, prev => prev ?? newGame(seed))
    const current = await read($, game)
    if (current && !current.paused && !isGameOver(current) && !timer) schedule($, existed ? interval(current.level) : 0)
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
    const status = isGameOver(current) ? '遊戲結束' : current.paused ? '已暫停' : current.locked ? '正在固定（下一 tick）' : '遊戲中'
    /** 並排：棋盤 20 欄＋間隔 1＋右欄 21（最長為狀態「正在固定（下一 tick）」），高度取棋盤 20 列。 */
    const sideBySide = e.props.bodyColumns >= 42
    /** 直排：棋盤 20 + 按鈕（橫排 1、直排 4）+ 落底／暫停／重開 3 + 狀態與下一塊 2 + 預覽 2 + 統計 3。 */
    const minRows = sideBySide ? 20 : e.props.bodyColumns < 36 ? 34 : 31
    if (e.props.bodyColumns < 22 || e.props.scroll.bodyRows < minRows) return <Box flexDirection="column">
      <Text>{`面板至少需要 22 欄與 ${minRows} 列（目前 ${e.props.bodyColumns} 欄 × ${e.props.scroll.bodyRows} 列，${e.props.placement}），請放大終端或面板。`}</Text>
      <Text>{status}</Text>
      <Button key="pause" label={current.paused ? '繼續 P' : '暫停 P'} hotkey="p" onPress={() => pause($)} />
      <Button key="restart" label="重新開始 R" hotkey="r" onPress={() => restart($)} />
    </Box>
    const board = <Raster key="board" columns={20} rows={20} cells={raster(current)} />
    const left = <Button key="left" label="左 A" hotkey="a" onPress={() => update($, game, prev => prev ? move(prev, 'left') : prev)} />
    const right = <Button key="right" label="右 D" hotkey="d" onPress={() => update($, game, prev => prev ? move(prev, 'right') : prev)} />
    const down = <Button key="down" label="下 S" hotkey="s" onPress={() => update($, game, prev => prev ? move(prev, 'down') : prev)} />
    const turn = <Button key="rotate" label="旋轉 W" hotkey="w" onPress={() => update($, game, prev => prev ? rotate(prev) : prev)} />
    const actions = [
      <Button key="drop" label="落底 F" hotkey="f" onPress={() => update($, game, prev => prev ? drop(prev) : prev)} />,
      <Button key="pause" label={current.paused ? "繼續 P" : "暫停 P"} hotkey="p" onPress={() => pause($)} />,
      <Button key="restart" label="重新開始 R" hotkey="r" onPress={() => restart($)} />,
    ]
    const info = [
      <Text>{status}</Text>,
      <Text key="next">{`下一塊：${current.next}`}</Text>,
      <Text>{preview(current.next)}</Text>,
      <Text key="score">{`分數：${current.score}`}</Text>,
      <Text key="lines">{`消行：${current.lines}`}</Text>,
      <Text key="level">{`等級：${current.level}`}</Text>,
    ]
    if (sideBySide) return <Box flexDirection="row" columnGap={1}>
      {board}
      <Box flexDirection="column">
        {info}
        <Box flexDirection="row" columnGap={1}>{left}{right}</Box>
        <Box flexDirection="row" columnGap={1}>{down}{turn}</Box>
        {actions}
      </Box>
    </Box>
    return <Box flexDirection="column">
      {board}
      <Box flexDirection={e.props.bodyColumns < 36 ? "column" : "row"}>{left}{right}{down}{turn}</Box>
      {actions}
      {info}
    </Box>
  })
}
