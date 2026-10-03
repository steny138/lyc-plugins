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
const hosting = atom({ plugin: 'sudoku-online', key: 'hosting' } as const, null)

/** 共同服務啟動時在 stdout 印出的第一行 */
type Listening = { port: number; addresses: string[] }

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
    if (prev?.url !== url || prev.isExpired) return prev
    if (state === null) return { ...prev, isConnected: false }
    // 實例識別碼改變：共同服務重啟過，原局已失效，不採用新實例的狀態
    if (prev.state && prev.state.instanceId !== state.instanceId) return { ...prev, isConnected: true, isExpired: true }

    return { ...prev, state, isConnected: true }
  })
}

/** Pane 開著、已畫在畫面上、且是目前顯示的分頁 */
const isPaneVisible = async ($: EngineInterface): Promise<boolean> =>
  (await $.ui.panes()).some(pane => pane.id === PANE && pane.isPlaced && pane.isShown)

/** 請共同服務把計數加一，再讀回狀態；連不上時由 refresh 標記中斷 */
const bump = async ($: EngineInterface, url: string) => {
  try {
    await $.http.fetch(`${url}/bump`, { method: 'POST' })
  } catch {
    // 連不上：下面的 refresh 會標記中斷
  }
  await refresh($, url)
}

/** 目前的輪詢計時器；模組重新載入時歸零，由下一次 join 重新啟動 */
let poller: Timer | null = null

/** 每秒輪詢共同服務；寫入 connection 會讓面板重畫，所以輪詢只要更新狀態 */
const startPolling = ($: EngineInterface, url: string) => {
  poller?.cancel()
  poller = $.clock.every(POLL_MS, () => void refresh($, url))
}

/** 連上共同服務並開始輪詢 */
const connect = async ($: EngineInterface, url: string) => {
  await update($, connection, () => ({ url, state: null, isConnected: false, isExpired: false }))
  await refresh($, url)
  startPolling($, url)
}

/**
 * 以 Node 子程序啟動共同服務。子程序活多久，這個迴圈就跑多久；
 * 模組卸載時引擎會結束子程序（ADR 0001）。
 */
const host = async ($: EngineInterface) => {
  await update($, hosting, () => ({ status: 'starting' as const }))
  let stdout = ''
  let stderr = ''
  let reason: string
  try {
    const child = $.process.spawn({ argv: ['node', `${$.plugin.root}/service/server.ts`] })
    for await (const { stream, text } of child) {
      if (stream === 'stderr') {
        stderr += text
        continue
      }
      stdout += text
      const newline = stdout.indexOf('\n')
      if (newline === -1 || (await read($, hosting))?.status === 'running') continue
      const { port, addresses } = JSON.parse(stdout.slice(0, newline)) as Listening
      await update($, hosting, () => ({
        status: 'running' as const,
        shareUrls: addresses.map(address => `http://${address}:${port}`),
      }))
      await connect($, `http://127.0.0.1:${port}`)
    }
    reason = stderr.trim().split('\n').at(-1) || '共同服務已結束'
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }
  await update($, hosting, () => ({ status: 'failed' as const, reason }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sudoku-online',
      description: '數獨對戰：/sudoku-online host 啟動共同服務、/sudoku-online join <位址> 加入',
    })
    // 熱重載也會走到這裡：引擎卸載舊模組時已結束共同服務子程序（ADR 0001），
    // 但 hosting 存在 session 狀態裡不會清掉，要改成已中止
    await update($, hosting, prev =>
      prev?.status === 'running' || prev?.status === 'starting'
        ? { status: 'failed' as const, reason: '模組重新載入，共同服務已中止' }
        : prev,
    )
    // 輪詢計時器是模組變數，重載後就沒了；connection 還在就接著輪詢
    const current = await read($, connection)
    if (current) startPolling($, current.url)

    return next(e)
  })

  on('command.run', { command: 'sudoku-online' }, async ($, e) => {
    const [action, url] = e.args.trim().split(/\s+/)
    if (action === 'host') {
      void host($)
      await $.ui.open(OPEN_ARGS)

      return { text: '正在啟動共同服務…' }
    }
    if (action === 'join' && url) {
      await connect($, url)
      await $.ui.open(OPEN_ARGS)

      return { text: `已連線共同服務 ${url}。` }
    }
    // 不帶參數時是開關：看得到就關掉，否則打開
    if (await isPaneVisible($)) {
      await $.ui.close({ id: PANE })

      return { text: '數獨對戰面板已關閉。' }
    }
    await $.ui.open(OPEN_ARGS)

    return { text: '數獨對戰面板已開啟。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, connection)
    const hosted = await read($, hosting)
    const hostLine =
      hosted === null ? null : hosted.status === 'starting' ? (
        <Text dimColor>共同服務啟動中…</Text>
      ) : hosted.status === 'running' ? (
        <Box flexDirection="column">
          {hosted.shareUrls.map(shareUrl => (
            <Text key={shareUrl} color="green">{`分享位址：${shareUrl}`}</Text>
          ))}
        </Box>
      ) : (
        <Text color="red">{`共同服務啟動失敗：${hosted.reason}`}</Text>
      )
    if (current === null) {
      return (
        <Box flexDirection="column" paddingTop={1} paddingLeft={2}>
          {hostLine}
          <Text dimColor>輸入 /sudoku-online host 啟動共同服務，或 /sudoku-online join &lt;位址&gt; 加入</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingTop={1} paddingLeft={2}>
        {hostLine}
        <Text>{`共同服務：${current.url}`}</Text>
        {current.isExpired ? (
          <Text color="red">原局已失效，請重新加入</Text>
        ) : (
          <Text>{current.state ? `計數：${current.state.count}` : '讀取中…'}</Text>
        )}
        {current.isConnected ? null : <Text color="red">連線中斷</Text>}
        <Box marginTop={1}>
          <Button key="bump" label="+1" hotkey="b" onPress={() => void bump($, current.url)} />
        </Box>
      </Box>
    )
  })
}
