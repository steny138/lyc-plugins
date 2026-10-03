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
