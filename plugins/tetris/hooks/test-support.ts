import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
export const stubEngine = (on: On) => {
  const env = { isOpen: false, isShown: true }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', () => { env.isOpen = true; return { value: { isPlaced: true as const } } })
  on('ui.close', () => { env.isOpen = false; return { value: undefined } })
  on('ui.panes', () => ({ value: env.isOpen ? [{ id: 'tetris', title: '俄羅斯方塊', isShown: env.isShown, isFocused: true, isPlaced: true }] : [] }))
  return env
}
export const run = ($: Engine) => $.command.run({ command: 'tetris', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } })
export const mountPane = ($: Engine) => $.ui.mount({ plugin: 'tetris', surface: 'terminal', component: 'Pane', requestId: 'tetris', props: { title: '俄羅斯方塊', isFocused: true, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 32 }, view: {} } })
export type Ui = Awaited<ReturnType<typeof mountPane>>
/** 只從 Raster 外部畫面讀回遊戲格，不存取 atom。 */
export const board = async (ui: Ui) => {
  const el = await ui.find({ key: 'board' })
  const bytes = Uint8Array.fromBase64(el.props.cells as string)
  const data = new DataView(bytes.buffer)
  return Array.from({ length: 20 }, (_, row) => Array.from({ length: 10 }, (_, col) => String.fromCharCode(data.getUint32((row * 20 + col * 2) * 12, true))).join(''))
}
