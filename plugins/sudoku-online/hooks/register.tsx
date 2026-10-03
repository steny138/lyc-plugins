import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ServiceState } from '../types'

const PANE = 'sudoku-online'
const TITLE = '數獨對戰'
/** dock 時的寬度；inline 時的高度 */
const OPEN_ARGS = { id: PANE, title: TITLE, columns: 72, rows: 26 }

const connection = atom({ plugin: 'sudoku-online', key: 'connection' } as const, null)

/** 向共同服務讀取目前狀態，存進 connection */
const refresh = async ($: EngineInterface, url: string) => {
  const response = await $.http.fetch(`${url}/state`)
  const state = JSON.parse(response.text) as ServiceState
  await update($, connection, prev => (prev?.url === url ? { ...prev, state } : prev))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sudoku-online', description: '數獨對戰：/sudoku-online join <位址>' })

    return next(e)
  })

  on('command.run', { command: 'sudoku-online' }, async ($, e) => {
    const [action, url] = e.args.trim().split(/\s+/)
    if (action === 'join' && url) {
      await update($, connection, () => ({ url, state: null }))
      await refresh($, url)
      await $.ui.open(OPEN_ARGS)

      return { text: `已連線共同服務 ${url}。` }
    }
    await $.ui.open(OPEN_ARGS)

    return { text: '數獨對戰面板已開啟。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = await read($, connection)
    if (current === null) return <Text dimColor>輸入 /sudoku-online join &lt;位址&gt; 連線共同服務</Text>

    return (
      <Box flexDirection="column" paddingTop={1} paddingLeft={2}>
        <Text>{`共同服務：${current.url}`}</Text>
        <Text>{current.state ? `計數：${current.state.count}` : '讀取中…'}</Text>
      </Box>
    )
  })
}
