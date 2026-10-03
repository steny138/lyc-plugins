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

/** 假網路：`isDown` 為 true 時所有請求都連不上 */
type Network = { isDown: boolean }

/** 把 `$.http.fetch` 導到同一份共同服務核心，代替真實網路 */
const routeFetch = (on: On, service: Service, network: Network = { isDown: false }) =>
  on('http.fetch', (_$, e) => {
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

describe('連線共同服務', () => {
  test('join 後面板顯示共同服務目前的計數', async ($, on) => {
    stubEngine(on)
    const service = createService('instance-1')
    service.handle({ method: 'POST', path: '/bump' })
    routeFetch(on, service)

    await run($, 'join http://test:47900')

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '共同服務：http://test:47900' })).toBeDefined()
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

describe('房主一鍵啟動共同服務', () => {
  test('啟動後顯示可分享的區網位址，並連上本機的共同服務', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, createService('instance-1'))
    // 子程序印出位址後持續執行（等一個不會到的時間）
    on('process.spawn', async function* () {
      yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.1.5"]}\n' }
      await clock.sleep(24 * 60 * 60 * 1000)

      return { value: { code: 0, signal: null } }
    })

    await run($, 'host')
    await clock.settle()

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.1.5:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '共同服務：http://127.0.0.1:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '計數：0' })).toBeDefined()
  })

  test('房主電腦有多個區網位址時全部列出', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    routeFetch(on, createService('instance-1'))
    on('process.spawn', async function* () {
      yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.0.113","192.168.139.3"]}\n' }
      await clock.sleep(24 * 60 * 60 * 1000)

      return { value: { code: 0, signal: null } }
    })

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
    routeFetch(on, createService('instance-1'))
    on('process.spawn', async function* () {
      yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.1.5"]}\n' }
      await clock.sleep(24 * 60 * 60 * 1000)

      return { value: { code: 0, signal: null } }
    })
    await run($, 'host')
    await clock.settle()

    await reload($)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '分享位址：http://192.168.1.5:47900' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '共同服務啟動失敗：模組重新載入，共同服務已中止' })).toBeDefined()
  })
})

describe('共同服務實例改變', () => {
  test('同一位址換成另一個共同服務實例時，面板顯示原局已失效，不顯示新實例的計數', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const first = createService('instance-1')
    first.handle({ method: 'POST', path: '/bump' })
    const second = createService('instance-2')
    const network = { service: first }
    on('http.fetch', (_$, e) => {
      const path = e.url.replace(/^https?:\/\/[^/]+/, '') || '/'
      const response = network.service.handle({ method: e.init?.method ?? 'GET', path, body: e.init?.body })

      return { value: { ...response, ok: response.status >= 200 && response.status < 300, headers: {} } }
    })
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()

    // 房主重啟共同服務：同一個位址，新的實例
    network.service = second
    await clock.advance(1000)

    expect(await ui.find({ type: 'Text', text: '原局已失效，請重新加入' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '計數：0' })).toBeUndefined()
  })
})

describe('送出請求', () => {
  test('在面板按 +1 後，共同服務的計數增加，面板一秒內顯示新計數', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1')
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.press({ key: 'bump' })
    await clock.advance(1000)

    expect(JSON.parse(service.handle({ method: 'GET', path: '/state' }).text).count).toBe(1)
    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()
  })
})

describe('輪詢', () => {
  test('共同服務的計數改變後，一秒內面板跟著更新', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1')
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '計數：0' })).toBeDefined()

    service.handle({ method: 'POST', path: '/bump' })
    await clock.advance(1000)

    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()
  })

  test('連不上共同服務時顯示連線中斷，恢復後顯示回計數', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1')
    const network = { isDown: false }
    routeFetch(on, service, network)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    network.isDown = true
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '連線中斷' })).toBeDefined()

    network.isDown = false
    service.handle({ method: 'POST', path: '/bump' })
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '連線中斷' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()
  })

  test('面板關閉再開啟後仍顯示同一個共同服務與計數', async ($, on) => {
    const env = stubEngine(on)
    const service = createService('instance-1')
    service.handle({ method: 'POST', path: '/bump' })
    routeFetch(on, service)
    await run($, 'join http://test:47900')
    await (await mountPane($)).unmount()

    env.isOpen = false
    await run($)

    const ui = await mountPane($)
    expect(await ui.find({ type: 'Text', text: '共同服務：http://test:47900' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '計數：1' })).toBeDefined()
  })
})
