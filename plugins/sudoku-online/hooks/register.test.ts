import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { createService } from '../service/core.ts'
import type { Service } from '../service/core.ts'

const PANE = 'sudoku-online'

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
    value: env.isOpen ? [{ id: PANE, title: '數獨對戰', isShown: env.isShown, isFocused: false, isPlaced: true }] : [],
  }))

  return env
}

/** 依序產生 cred-1、cred-2…，代替隨機的玩家憑證 */
const credentials = () => {
  let n = 0

  return () => `cred-${++n}`
}

/** 測試用的共同服務核心 */
const newService = (instanceId = 'instance-1') => createService(instanceId, { newCredential: credentials() })

/** 另一位玩家直接對共同服務核心加入，等於另一個客戶端 */
const joinAs = (service: Service, nickname: string) =>
  service.handle({ method: 'POST', path: '/join', body: JSON.stringify({ nickname }) })

/** 假網路：`isDown` 為 true 時所有請求都連不上；`requests` 累計送達的請求數 */
type Network = { isDown: boolean; requests?: number }

/** 把 `$.http.fetch` 導到同一份共同服務核心，代替真實網路 */
const routeFetch = (on: On, service: Service, network: Network = { isDown: false }) =>
  on('http.fetch', (_$, e) => {
    network.requests = (network.requests ?? 0) + 1
    if (network.isDown) throw new Error('connect ECONNREFUSED')
    const path = e.url.replace(/^https?:\/\/[^/]+/, '') || '/'
    const response = service.handle({ method: e.init?.method ?? 'GET', path, body: e.init?.body })

    return { value: { ...response, ok: response.status >= 200 && response.status < 300, headers: {} } }
  })

/** 模擬使用者在終端機輸入 /sudoku-online <args> */
const run = ($: Engine, args = '') => {
  const input: CommandRunInput = {
    command: 'sudoku-online',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  }

  return $.command.run(input)
}

const mountPane = ($: Engine) =>
  $.ui.mount({
    plugin: 'sudoku-online',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE,
    props: {
      title: '數獨對戰',
      isFocused: false,
      bodyColumns: 72,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })

/** 子程序印出位址後持續執行（等一個不會到的時間） */
const spawnListening = (on: On, clock: { sleep: (ms: number) => Promise<void> }, addresses = ['192.168.1.5']) =>
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: `${JSON.stringify({ port: 47900, addresses })}\n` }
    await clock.sleep(24 * 60 * 60 * 1000)

    return { value: { code: 0, signal: null } }
  })

describe('加入與暱稱', () => {
  test('輸入暱稱加入後看到自己與玩家名單，其他人加入時名單一秒內更新', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = newService()
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: 'Alice' })

    expect(await ui.find({ type: 'Text', text: '你是 Alice' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Alice' })).toBeDefined()

    joinAs(service, 'Bob')
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()
  })

  test('暱稱和別人重複時，共同服務自動加上後綴', async ($, on) => {
    stubEngine(on)
    const service = newService()
    joinAs(service, 'Alice')
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: 'Alice' })

    expect(await ui.find({ type: 'Text', text: '你是 Alice#2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Alice' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Alice#2' })).toBeDefined()
  })

  test('只有空白的暱稱被拒絕，顯示原因並停在輸入框', async ($, on) => {
    stubEngine(on)
    routeFetch(on, newService())
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: '   ' })

    expect(await ui.find({ type: 'Text', text: '請輸入暱稱' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'nickname' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '玩家（0）' })).toBeDefined()
  })

  test('超過 12 個字的暱稱被拒絕，剛好 12 個字可以加入', async ($, on) => {
    stubEngine(on)
    routeFetch(on, newService())
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: '一二三四五六七八九十甲乙' + '丙' })
    expect(await ui.find({ type: 'Text', text: '暱稱最多 12 個字' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '玩家（0）' })).toBeDefined()

    await ui.input({ key: 'nickname', text: '一二三四五六七八九十甲乙' })
    expect(await ui.find({ type: 'Text', text: '你是 一二三四五六七八九十甲乙' })).toBeDefined()
  })
})

describe('連線共同服務', () => {
  test('join 後面板顯示共同服務位址與目前的玩家名單', async ($, on) => {
    stubEngine(on)
    const service = newService()
    joinAs(service, 'Bob')
    routeFetch(on, service)

    await run($, 'join http://test:47900')

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '共同服務：http://test:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()
  })
})

describe('面板開關', () => {
  test('面板看得到時再執行 /sudoku-online 就關閉', async ($, on) => {
    const env = stubEngine(on)
    await run($)

    const { text } = await run($)
    expect(text).toContain('已關閉')
    expect(env.isOpen).toBe(false)
  })
})

describe('面板關閉時斷開連線', () => {
  test('玩家關閉面板後不再輪詢共同服務', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const network: Network = { isDown: false }
    routeFetch(on, newService(), network)
    await run($, 'join http://test:47900')

    await run($) // 面板看得到，再執行一次就關閉
    const before = network.requests
    await clock.advance(5000)

    expect(network.requests).toBe(before)
  })

  test('重新打開面板時立刻讀到最新狀態，之後繼續輪詢', async ($, on) => {
    const env = stubEngine(on)
    const clock = mock.clock(on)
    const service = newService()
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    await run($)

    joinAs(service, 'Bob')
    env.isOpen = false
    await run($)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()

    joinAs(service, 'Carol')
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '・Carol' })).toBeDefined()
  })

  test('房主關閉面板時結束共同服務子程序，重新打開顯示已停止', async ($, on) => {
    const env = stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, newService())
    const child = { isRunning: false }
    on('process.spawn', async function* (_$, _e, next) {
      child.isRunning = true
      try {
        yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.1.5"]}\n' }
        // 假子程序一直執行，直到引擎因為 plugin 離開串流而中止它
        await new Promise<void>(resolve => next.signal.addEventListener('abort', () => resolve()))

        return { value: { code: null, signal: 'SIGTERM' } }
      } finally {
        child.isRunning = false
      }
    })
    await run($, 'host')
    await clock.settle()
    expect(child.isRunning).toBe(true)

    await run($) // 面板看得到，再執行一次就關閉
    await clock.settle()
    expect(child.isRunning).toBe(false)

    env.isOpen = false
    await run($)
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '共同服務已停止：房主關閉了面板' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.1.5:47900' })).toBeUndefined()
  })
})

describe('房主一鍵啟動共同服務', () => {
  test('啟動後顯示可分享的區網位址，並連上本機的共同服務', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, newService())
    spawnListening(on, clock)

    await run($, 'host')
    await clock.settle()

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.1.5:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '共同服務：http://127.0.0.1:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '玩家（0）' })).toBeDefined()
  })

  test('房主電腦有多個區網位址時全部列出', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, newService())
    spawnListening(on, clock, ['192.168.0.113', '192.168.139.3'])

    await run($, 'host')
    await clock.settle()

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.0.113:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.139.3:47900' })).toBeDefined()
  })

  test('共同服務啟動失敗時顯示失敗原因', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    on('process.spawn', async function* () {
      yield { stream: 'stderr' as const, text: 'listen EADDRINUSE: address already in use 0.0.0.0:47900\n' }

      return { value: { code: 1, signal: null } }
    })

    await run($, 'host')
    await clock.settle()

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '共同服務啟動失敗：listen EADDRINUSE: address already in use 0.0.0.0:47900' })).toBeDefined()
  })
})

/** 模擬模組熱重載：引擎會再發一次 session.start（模組變數在測試中不會歸零） */
const reload = ($: Engine) => $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

describe('模組重新載入', () => {
  test('房主的共同服務在重新載入時被終止，面板改顯示已中止', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, newService())
    spawnListening(on, clock)
    await run($, 'host')
    await clock.settle()

    await reload($)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.1.5:47900' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '共同服務啟動失敗：模組重新載入，共同服務已中止' })).toBeDefined()
  })
})

describe('共同服務實例改變', () => {
  test('同一位址換成另一個共同服務實例時，面板顯示原局已失效，不顯示新實例的名單', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const first = newService('instance-1')
    joinAs(first, 'Bob')
    const second = newService('instance-2')
    joinAs(second, 'Mallory')
    const network = { service: first }
    on('http.fetch', (_$, e) => {
      const path = e.url.replace(/^https?:\/\/[^/]+/, '') || '/'
      const response = network.service.handle({ method: e.init?.method ?? 'GET', path, body: e.init?.body })

      return { value: { ...response, ok: response.status >= 200 && response.status < 300, headers: {} } }
    })
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()

    // 房主重啟共同服務：同一個位址，新的實例
    network.service = second
    await clock.advance(1000)

    expect(await ui.find({ type: 'Text', text: '原局已失效，請重新加入' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Mallory' })).toBeUndefined()
  })
})

describe('輪詢', () => {
  test('連不上共同服務時顯示連線中斷，恢復後名單繼續更新', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = newService()
    const network = { isDown: false }
    routeFetch(on, service, network)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    network.isDown = true
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '連線中斷' })).toBeDefined()

    network.isDown = false
    joinAs(service, 'Bob')
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '連線中斷' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()
  })

  test('面板關閉再開啟後仍顯示同一個共同服務與名單', async ($, on) => {
    const env = stubEngine(on)
    const service = newService()
    joinAs(service, 'Bob')
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    await (await mountPane($)).unmount()

    env.isOpen = false
    await run($)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '共同服務：http://test:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()
  })
})
