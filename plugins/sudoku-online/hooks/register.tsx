import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { ServiceState } from '../types'

const PANE = 'sudoku-online'
const TITLE = '數獨對戰'
/** dock 時的寬度；inline 時的高度 */
const OPEN_ARGS = { id: PANE, title: TITLE, columns: 72, rows: 26 }
/** 輪詢共同服務的間隔 */
const POLL_MS = 1000

const connection = atom({ plugin: 'sudoku-online', key: 'connection' } as const, null)

/** 向共同服務讀取目前狀態，存進 connection；連不上時只標記中斷，保留最後的狀態 */
const refresh = async ($: EngineInterface, url: string) => {
  let state: ServiceState | null = null
  try {
    const response = await $.http.fetch(`${url}/state`)
    if (response.ok) state = JSON.parse(response.text) as ServiceState
  } catch {
    // 連不上：交給下面標記為中斷
  }
  await update($, connection, prev => {
    if (prev?.url !== url) return prev

    return state ? { ...prev, state, isConnected: true } : { ...prev, isConnected: false }
  })
}

export const register: Register = on => {
  /** 目前的輪詢計時器；模組重新載入時歸零，由下一次 join 重新啟動 */
  let poller: Timer | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sudoku-online', description: '數獨對戰：/sudoku-online join <位址>' })

    return next(e)
  })

  on('command.run', { command: 'sudoku-online' }, async ($, e) => {
    const [action, url] = e.args.trim().split(/\s+/)
    if (action === 'join' && url) {
      await update($, connection, () => ({ url, state: null, isConnected: false }))
      await refresh($, url)
      // 寫入 connection 會讓面板重畫，所以輪詢只要更新狀態
      poller?.cancel()
      poller = $.clock.every(POLL_MS, () => void refresh($, url))
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
        {current.isConnected ? null : <Text color="red">連線中斷</Text>}
      </Box>
    )
  })
}
