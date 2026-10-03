import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Difficulty, Me, PlayerSummary, ServiceState } from '../types'

const PANE = 'sudoku-online'
const TITLE = '數獨對戰'
/** dock 時的寬度；inline 時的高度 */
const OPEN_ARGS = { id: PANE, title: TITLE, columns: 72, rows: 26 }
/** 輪詢共同服務的間隔 */
const POLL_MS = 1000
/** 名單與「你是 …」上的房主標示 */
const HOST_MARK = '（房主）'
/** 名單上已準備的標示 */
const READY_MARK = '（已準備）'

/** 各難度的名稱與開局快捷鍵；開局按鈕依這個順序排列 */
const LEVELS: Record<Difficulty, { label: string; hotkey: string }> = {
  easy: { label: '簡單', hotkey: 'e' },
  medium: { label: '中等', hotkey: 'm' },
  hard: { label: '困難', hotkey: 'h' },
}
const DIFFICULTIES = Object.keys(LEVELS) as Difficulty[]

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

/** 以暱稱加入共同服務，存下共同服務發給的身分，再讀回名單；連不上時由 refresh 標記中斷 */
const joinWithNickname = async ($: EngineInterface, url: string, nickname: string) => {
  // 房主連自己啟動的共同服務時帶上房主密鑰，取得房主身分
  const hosted = await read($, hosting)
  const hostKey = hosted?.status === 'running' && hosted.localUrl === url ? hosted.hostKey : undefined
  try {
    const response = await $.http.fetch(`${url}/join`, { method: 'POST', body: JSON.stringify({ nickname, hostKey }) })
    if (response.ok) {
      const me = JSON.parse(response.text) as Me
      await update($, connection, prev => (prev?.url === url ? { ...prev, me, joinError: null } : prev))
    } else {
      // 共同服務是暱稱規則的唯一依據：直接顯示它給的原因
      const { error } = JSON.parse(response.text) as { error?: string }
      const joinError = error ?? '加入失敗'
      await update($, connection, prev => (prev?.url === url ? { ...prev, joinError } : prev))
    }
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

/** 停止輪詢；面板關閉時呼叫 */
const stopPolling = () => {
  poller?.cancel()
  poller = null
}

/** 已經加入過共同服務時，立刻讀一次最新狀態並恢復輪詢；面板打開或重載後呼叫 */
const resume = async ($: EngineInterface) => {
  const current = await read($, connection)
  if (current === null) return
  await refresh($, current.url)
  startPolling($, current.url)
}

/** 表示準備或取消準備，再讀回名單；連不上時由 refresh 標記中斷 */
const setReady = async ($: EngineInterface, url: string, credential: string, isReady: boolean) => {
  try {
    await $.http.fetch(`${url}/ready`, { method: 'POST', body: JSON.stringify({ credential, isReady }) })
  } catch {
    // 連不上：下面的 refresh 會標記中斷
  }
  await refresh($, url)
}

/**
 * 送出需要身分的操作（開局、移出），再讀回狀態。
 * 共同服務拒絕時把原因存進 actionError 顯示在面板；成功就清掉。
 */
const act = async ($: EngineInterface, url: string, path: string, body: Record<string, unknown>) => {
  try {
    const response = await $.http.fetch(`${url}${path}`, { method: 'POST', body: JSON.stringify(body) })
    const actionError = response.ok ? null : ((JSON.parse(response.text) as { error?: string }).error ?? '操作失敗')
    await update($, connection, prev => (prev?.url === url ? { ...prev, actionError } : prev))
  } catch {
    // 連不上：下面的 refresh 會標記中斷
  }
  await refresh($, url)
}

/** 以存下的玩家憑證向共同服務確認身分；共同服務不認得（例如換了實例）就回 null */
const confirmMe = async ($: EngineInterface, url: string, me: Me): Promise<Me | null> => {
  try {
    const response = await $.http.fetch(`${url}/join`, {
      method: 'POST',
      body: JSON.stringify({ credential: me.credential }),
    })
    const confirmed = response.ok ? (JSON.parse(response.text) as Me) : null

    return confirmed?.credential === me.credential ? confirmed : null
  } catch {
    // 連不上就先沿用本機的身分，輪詢會標記中斷
    return me
  }
}

/** 連上共同服務並開始輪詢；對同一個共同服務再加入時，沿用原本的玩家身分 */
const connect = async ($: EngineInterface, url: string) => {
  const prev = await read($, connection)
  const me = prev?.url === url && prev.me && !prev.isExpired ? await confirmMe($, url, prev.me) : null
  await update($, connection, () => ({
    url,
    state: null,
    isConnected: false,
    isExpired: false,
    me,
    joinError: null,
    actionError: null,
  }))
  await refresh($, url)
  startPolling($, url)
}

/** 共同服務子程序的輸出串流；結束這個串流就會結束子程序 */
let hostChild: AsyncGenerator<unknown, unknown> | null = null
/** 房主主動停止共同服務的原因；子程序因此結束時用它代替失敗原因 */
let stopReason: string | null = null

/** 房主停止共同服務：結束串流，引擎隨之結束子程序 */
const stopHosting = (reason: string) => {
  if (hostChild === null) return
  stopReason = reason
  void hostChild.return(undefined)
  hostChild = null
}

/**
 * 以 Node 子程序啟動共同服務。子程序活多久，這個迴圈就跑多久；
 * 房主關閉面板或模組卸載時子程序結束（ADR 0001）。
 */
const host = async ($: EngineInterface) => {
  await update($, hosting, () => ({ status: 'starting' as const }))
  let stdout = ''
  let stderr = ''
  let reason: string
  stopReason = null
  // 只有房主 mod 知道這串密鑰，區網上的其他人搶不走房主身分
  const hostKey = crypto.randomUUID()
  try {
    const child = $.process.spawn({
      argv: ['node', `${$.plugin.root}/service/server.ts`],
      env: { SUDOKU_ONLINE_HOST_KEY: hostKey },
    })
    hostChild = child
    for await (const { stream, text } of child) {
      if (stream === 'stderr') {
        stderr += text
        continue
      }
      stdout += text
      const newline = stdout.indexOf('\n')
      if (newline === -1 || (await read($, hosting))?.status === 'running') continue
      const { port, addresses } = JSON.parse(stdout.slice(0, newline)) as Listening
      const localUrl = `http://127.0.0.1:${port}`
      await update($, hosting, () => ({
        status: 'running' as const,
        shareUrls: addresses.map(address => `http://${address}:${port}`),
        localUrl,
        hostKey,
      }))
      await connect($, localUrl)
    }
    reason = stderr.trim().split('\n').at(-1) || '共同服務已結束'
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }
  hostChild = null
  const stopped = stopReason
  await update($, hosting, () =>
    stopped === null ? { status: 'failed' as const, reason } : { status: 'stopped' as const, reason: stopped },
  )
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
    // 輪詢計時器是模組變數，重載後就沒了；面板還看得到就接著輪詢
    if (await isPaneVisible($)) await resume($)

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
    await resume($)
    await $.ui.open(OPEN_ARGS)

    return { text: '數獨對戰面板已開啟。' }
  })

  // 按 ✕ 或再執行一次指令都會走到這裡；模組卸載（unload）時引擎不會呼叫這個 hook
  on('ui.close', async ($, e, next) => {
    const closed = await next(e)
    if (e.id === PANE) {
      stopPolling()
      // 房主關閉面板就結束共同服務，本局隨之中止
      stopHosting('房主關閉了面板')
    }

    return closed
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    // 行動版沒有輸入框（claude-code.d.ts 的 Elements.mobile），只能在電腦上輸入暱稱
    const Input = 'Input' in elements ? elements.Input : null
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
      ) : hosted.status === 'stopped' ? (
        <Text color="yellow">{`共同服務已停止：${hosted.reason}`}</Text>
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

    // 大廳階段、非房主的參賽者才有準備按鈕；房主按開局就算準備
    const mine = current.state?.players.find(player => player.nickname === current.me?.nickname)
    const me = current.me
    const readyButton =
      me && !me.isHost && mine?.role === 'participant' && current.state?.phase === 'lobby' ? (
        <Box marginTop={1}>
          <Button
            key="ready"
            label={mine.isReady ? '取消準備' : '準備'}
            hotkey="r"
            onPress={() => void setReady($, current.url, me.credential, !mine.isReady)}
          />
        </Box>
      ) : null

    const participants = current.state?.players.filter(player => player.role === 'participant') ?? []
    const candidates = current.state?.players.filter(player => player.role === 'candidate') ?? []
    // 房主在大廳可以移出還沒準備的參賽者（不含自己）
    const canRemove = (player: PlayerSummary) =>
      me?.isHost === true && current.state?.phase === 'lobby' && !player.isHost && !player.isReady

    // 大廳階段的房主才有開局按鈕，一個難度一個
    const startButtons =
      me?.isHost && current.state?.phase === 'lobby' ? (
        <Box marginTop={1} gap={1}>
          {DIFFICULTIES.map(difficulty => (
            <Button
              key={`start-${difficulty}`}
              label={`開局：${LEVELS[difficulty].label}`}
              hotkey={LEVELS[difficulty].hotkey}
              onPress={() => void act($, current.url, '/start', { credential: me.credential, difficulty })}
            />
          ))}
        </Box>
      ) : null

    return (
      <Box flexDirection="column" paddingTop={1} paddingLeft={2}>
        {hostLine}
        <Text>{`共同服務：${current.url}`}</Text>
        {current.isConnected ? null : <Text color="red">連線中斷</Text>}
        {current.isExpired ? (
          <Text color="red">原局已失效，請重新加入</Text>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {current.me === null && Input === null ? (
              <Text dimColor>請在電腦上的 Claude Code 輸入暱稱加入</Text>
            ) : current.me === null && Input !== null ? (
              <Input
                key="nickname"
                label="暱稱："
                placeholder="輸入暱稱後按 Enter 加入"
                submitLabel="加入"
                autoFocus
                onSubmit={(value: string) => void joinWithNickname($, current.url, value)}
              />
            ) : (
              <Text bold>{`你是 ${current.me?.nickname ?? ''}${current.me?.isHost ? HOST_MARK : ''}`}</Text>
            )}
            {current.me === null && current.joinError ? <Text color="red">{current.joinError}</Text> : null}
            {mine?.role === 'candidate' ? <Text color="yellow">你是候補者，等待下一局</Text> : null}
            {readyButton}
            {startButtons}
            {current.state?.phase === 'countdown' ? (
              <Text bold color="yellow">{`倒數 ${Math.ceil((current.state.startsInMs ?? 0) / 1000)} 秒`}</Text>
            ) : null}
            {current.actionError ? <Text color="red">{current.actionError}</Text> : null}
            {current.state === null ? (
              <Text dimColor>讀取中…</Text>
            ) : (
              <Box flexDirection="column" marginTop={1}>
                <Text dimColor>{`玩家（${participants.length}）`}</Text>
                {participants.map(player => (
                  <Box key={`player-${player.nickname}`} gap={1}>
                    <Text>{`・${player.nickname}${player.isHost ? HOST_MARK : ''}${player.isReady ? READY_MARK : ''}`}</Text>
                    {canRemove(player) && me ? (
                      <Button
                        key={`remove-${player.nickname}`}
                        label="移出"
                        plain
                        onPress={() =>
                          void act($, current.url, '/remove', { credential: me.credential, nickname: player.nickname })
                        }
                      />
                    ) : null}
                  </Box>
                ))}
                {candidates.length > 0 ? (
                  <Box flexDirection="column" marginTop={1}>
                    <Text dimColor>{`候補者（${candidates.length}）`}</Text>
                    {candidates.map(player => (
                      <Text key={`candidate-${player.nickname}`} dimColor>{`・${player.nickname}`}</Text>
                    ))}
                  </Box>
                ) : null}
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
