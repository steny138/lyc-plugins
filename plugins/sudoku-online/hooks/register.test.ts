import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandRunInput, On } from 'claude-code'

import { createService } from '../service/core.ts'
import type { Service } from '../service/core.ts'
import { solve } from '../service/sudoku.ts'

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

/** mock.clock 回傳的時鐘（只用到的部分） */
type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }

/** 把 `$.http.fetch` 導到同一份共同服務核心，代替真實網路；有時鐘時把它的時間交給共同服務 */
const routeFetch = (on: On, service: Service, network: Network = { isDown: false }, clock?: Clock) =>
  on('http.fetch', (_$, e) => {
    network.requests = (network.requests ?? 0) + 1
    if (network.isDown) throw new Error('connect ECONNREFUSED')
    const path = e.url.replace(/^https?:\/\/[^/]+/, '') || '/'
    const response = service.handle({ method: e.init?.method ?? 'GET', path, body: e.init?.body }, clock?.now() ?? 0)

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

describe('準備', () => {
  test('參賽者按準備後名單標示已準備，再按一次取消', async ($, on) => {
    stubEngine(on)
    routeFetch(on, newService())
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Alice' })

    await ui.press({ key: 'ready' })
    expect(await ui.find({ type: 'Text', text: '・Alice（已準備）' })).toBeDefined()

    await ui.press({ key: 'ready' })
    expect(await ui.find({ type: 'Text', text: '・Alice' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Alice（已準備）' })).toBeUndefined()
  })
})

/** 另一位玩家對核心送出需要身分的請求 */
const postAs = (service: Service, path: string, body: Record<string, unknown>, now = 0) =>
  service.handle({ method: 'POST', path, body: JSON.stringify(body) }, now)

/** 另一位玩家加入並回傳他的玩家憑證 */
const credentialOf = (service: Service, nickname: string) =>
  (JSON.parse(joinAs(service, nickname).text) as { credential: string }).credential

/**
 * 房主情境：一鍵啟動（假子程序把房主密鑰交給核心）、打開面板、以「Host」加入。
 * 回傳時鐘、面板與核心；核心在 spawn 時才建立，所以用函式取得。
 */
const hostAs = async ($: Engine, on: On) => {
  stubEngine(on)
  const clock = mock.clock(on)
  const holder: { service: Service | null } = { service: null }
  routeFetch(on, { handle: (request, now) => holder.service!.handle(request, now) }, { isDown: false }, clock)
  on('process.spawn', async function* (_$, e) {
    holder.service = createService('instance-1', {
      newCredential: credentials(),
      hostKey: e.env?.SUDOKU_ONLINE_HOST_KEY ?? '',
    })
    yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.1.5"]}\n' }
    await clock.sleep(24 * 60 * 60 * 1000)

    return { value: { code: 0, signal: null } }
  })
  await run($, 'host')
  await clock.settle()
  const ui = await mountPane($)
  await ui.input({ key: 'nickname', text: 'Host' })

  return { clock, ui, service: () => holder.service! }
}

describe('開局與倒數', () => {
  test('還有參賽者沒準備時，房主開局被拒絕並顯示是誰', async ($, on) => {
    const { clock, ui, service } = await hostAs($, on)
    joinAs(service(), 'Bob')
    await clock.advance(1000)

    await ui.press({ key: 'start-easy' })

    expect(await ui.find({ type: 'Text', text: '還有玩家沒準備：Bob' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '倒數 5 秒' })).toBeUndefined()
  })

  test('全員準備後房主開局，面板開始倒數；不是房主的人不能開局', async ($, on) => {
    const { clock, ui, service } = await hostAs($, on)
    const bob = credentialOf(service(), 'Bob')
    postAs(service(), '/ready', { credential: bob, isReady: true })
    expect(postAs(service(), '/start', { credential: bob, difficulty: 'easy' }).status).toBe(403)
    await clock.advance(1000)

    await ui.press({ key: 'start-easy' })
    expect(await ui.find({ type: 'Text', text: '倒數 5 秒' })).toBeDefined()

    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '倒數 4 秒' })).toBeDefined()
  })
})

describe('移出本局', () => {
  test('房主把未準備的 Bob 移出後，Bob 列為候補者，房主就能開局；不是房主的人不能移出', async ($, on) => {
    const { clock, ui, service } = await hostAs($, on)
    const bob = credentialOf(service(), 'Bob')
    const carol = credentialOf(service(), 'Carol')
    postAs(service(), '/ready', { credential: carol, isReady: true })
    expect(postAs(service(), '/remove', { credential: carol, nickname: 'Bob' }).status).toBe(403)
    expect(bob).toBeDefined()
    await clock.advance(1000)

    await ui.press({ key: 'remove-Bob' })

    expect(await ui.find({ type: 'Text', text: '候補者（1）' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'remove-Bob' })).toBeUndefined()

    await ui.press({ key: 'start-easy' })
    expect(await ui.find({ type: 'Text', text: '倒數 5 秒' })).toBeDefined()
  })

  test('被房主移出的玩家，面板顯示自己是候補者、等待下一局，也沒有準備按鈕', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Bob' })

    postAs(service, '/remove', { credential: host, nickname: 'Bob' })
    await clock.advance(1000)

    expect(await ui.find({ type: 'Text', text: '你是候補者，等待下一局' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'ready' })).toBeUndefined()
  })
})

/** 共同服務公開的狀態（直接讀核心，等於任何一個客戶端看到的） */
const publicState = (service: Service, now: number) =>
  JSON.parse(service.handle({ method: 'GET', path: '/state' }, now).text) as {
    phase: string
    difficulty?: string
    puzzle?: string
    roundId?: number
    ranking?: { nickname: string; rank: number; elapsedMs: number }[]
  }

/** 面板上可以點的格子（空格） */
const cellButtons = async (ui: Awaited<ReturnType<typeof mountPane>>) =>
  (await ui.findAll({ type: 'Button' })).filter(el => el.key?.startsWith('cell-'))

describe('公開題目', () => {
  test('倒數期間共同服務不公開題目；倒數結束後參賽者拿到同一道簡單題，面板出現盤面', async ($, on) => {
    const { clock, ui, service } = await hostAs($, on)
    await ui.press({ key: 'start-easy' })

    expect(publicState(service(), clock.now()).puzzle).toBeUndefined()
    expect(await cellButtons(ui)).toHaveLength(0)

    await clock.advance(5000)

    const revealed = publicState(service(), clock.now())
    expect(revealed.phase).toBe('playing')
    expect(revealed.difficulty).toBe('easy')
    expect(revealed.puzzle).toHaveLength(81)
    // 簡單題 44 個提示，剩下 37 格是可以點的空格，與共同服務公開的題目一致
    const blanks = [...(revealed.puzzle ?? '')].flatMap((ch, i) => (ch === '.' ? [`cell-${i}`] : []))
    expect(blanks).toHaveLength(81 - 44)
    expect((await cellButtons(ui)).map(el => el.key)).toEqual(blanks)
  })

  test('候補者在倒數結束後沒有盤面', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    postAs(service, '/start', { credential: host, difficulty: 'easy' }, clock.now())
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Late' })

    await clock.advance(5000)

    expect(publicState(service, clock.now()).phase).toBe('playing')
    expect(await cellButtons(ui)).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: '你是候補者，等待下一局' })).toBeDefined()
  })
})

/** 房主自己開一局簡單題並等倒數結束，回傳面板、核心、時鐘與第一個空格 */
const playAsHost = async ($: Engine, on: On) => {
  const hosted = await hostAs($, on)
  await hosted.ui.press({ key: 'start-easy' })
  await hosted.clock.advance(5000)
  const first = (await cellButtons(hosted.ui))[0]!.key!

  return { ...hosted, first }
}

/** 面板上某一格目前顯示的文字 */
const cellLabel = async (ui: Awaited<ReturnType<typeof mountPane>>, key: string) => {
  const el = await ui.find({ type: 'Button', key })

  return el?.type === 'Button' ? el.text : undefined
}

describe('本機填答', () => {
  test('選一個空格、按數字就填入，按清除恢復空白', async ($, on) => {
    const { ui, first } = await playAsHost($, on)

    await ui.press({ key: first })
    await ui.press({ key: 'digit-5' })
    expect(await cellLabel(ui, first)).toBe('5')

    await ui.press({ key: 'clear' })
    expect(await cellLabel(ui, first)).toBe('·')
  })

  test('填入和同列題目重複的數字時，該格標紅', async ($, on) => {
    const { ui, service, clock, first } = await playAsHost($, on)
    const puzzle = publicState(service(), clock.now()).puzzle!
    const i = Number(first.slice('cell-'.length))
    const row = Math.floor(i / 9)
    // 同一列裡任一個題目數字，填進這格一定衝突
    const clash = [...puzzle.slice(row * 9, row * 9 + 9)].find(ch => ch !== '.')!

    await ui.press({ key: first })
    await ui.press({ key: `digit-${clash}` })

    const redBoxes = (await ui.findAll({ type: 'Box' })).filter(el => el.props.backgroundColor === 'red')
    expect(redBoxes.length).toBeGreaterThan(0)
  })

  test('本機填答不會改到共同服務的題目', async ($, on) => {
    const { ui, service, clock, first } = await playAsHost($, on)
    const before = publicState(service(), clock.now()).puzzle

    await ui.press({ key: first })
    await ui.press({ key: 'digit-5' })

    expect(publicState(service(), clock.now()).puzzle).toBe(before)
  })
})

/** 依答案在面板上填完所有空格（跳過 `except` 指定的格子） */
const fillAnswer = async (ui: Awaited<ReturnType<typeof mountPane>>, puzzle: string, except: number[] = []) => {
  const answer = solve(puzzle)!
  for (let i = 0; i < 81; i++) {
    if (puzzle[i] !== '.' || except.includes(i)) continue
    await ui.press({ key: `cell-${i}` })
    await ui.press({ key: `digit-${answer[i]}` })
  }
}

describe('提交與名次', () => {
  test('房主填完正確盤面後自動提交，面板顯示名次與用時，盤面鎖住', async ($, on) => {
    const { ui, service, clock } = await playAsHost($, on)
    const puzzle = publicState(service(), clock.now()).puzzle!
    await clock.advance(30_000)

    await fillAnswer(ui, puzzle)

    expect(await ui.find({ type: 'Text', text: '你是第 1 名，用時 0:30' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1. Host 0:30' })).toBeDefined()
    expect(await cellButtons(ui)).toHaveLength(0)
    expect(await ui.find({ type: 'Button', key: 'clear' })).toBeUndefined()
  })

  test('Bob 先完成、房主後完成時依共同服務收到的順序排名，Bob 完成後房主仍能作答', async ($, on) => {
    const { ui, service, clock } = await hostAs($, on)
    const bob = credentialOf(service(), 'Bob')
    postAs(service(), '/ready', { credential: bob, isReady: true })
    await clock.advance(1000)
    await ui.press({ key: 'start-easy' })
    await clock.advance(5000)
    const { puzzle, roundId } = publicState(service(), clock.now())
    await clock.advance(20_000)

    const bobResult = postAs(service(), '/submit', { credential: bob, roundId, cells: solve(puzzle!) }, clock.now())
    expect(JSON.parse(bobResult.text)).toEqual({ rank: 1, elapsedMs: 20_000 })
    await clock.advance(10_000)
    expect(publicState(service(), clock.now()).phase).toBe('playing')

    await fillAnswer(ui, puzzle!)

    expect(await ui.find({ type: 'Text', text: '你是第 2 名，用時 0:30' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1. Bob 0:20' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '2. Host 0:30' })).toBeDefined()
  })
})

describe('本局狀態', () => {
  test('面板顯示本局目前的階段：等待準備、倒數中', async ($, on) => {
    const { ui } = await hostAs($, on)
    expect(await ui.find({ type: 'Text', text: '本局：等待準備' })).toBeDefined()

    await ui.press({ key: 'start-easy' })
    expect(await ui.find({ type: 'Text', text: '本局：倒數中' })).toBeDefined()
  })

  test('候補者也看得出本局已經開始', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    postAs(service, '/start', { credential: host, difficulty: 'easy' }, clock.now())
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Late' })

    await clock.advance(5000)

    expect(await ui.find({ type: 'Text', text: '本局：進行中' })).toBeDefined()
  })
})

/** 固定種子的亂數（mulberry32），讓出題可以重現 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

describe('出題亂數', () => {
  test('注入同一個固定種子的亂數時，兩個共同服務開出同一道題', () => {
    const puzzleWith = (seed: number) => {
      const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key', random: seeded(seed) })
      const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
        .credential
      postAs(service, '/start', { credential: host, difficulty: 'hard' }, 0)

      return publicState(service, 5000).puzzle
    }

    expect(puzzleWith(7)).toBe(puzzleWith(7))
  })
})

describe('同一道題', () => {
  test('房主與 Bob 都是參賽者時，兩人在正式開始後讀到同一道題，Bob 的面板盤面也是這道題', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Bob' })
    await ui.press({ key: 'ready' })

    expect(postAs(service, '/start', { credential: host, difficulty: 'medium' }, clock.now()).status).toBe(200)
    await clock.advance(5000)

    const { puzzle, difficulty } = publicState(service, clock.now())
    expect(difficulty).toBe('medium')
    const blanks = [...(puzzle ?? '')].flatMap((ch, i) => (ch === '.' ? [`cell-${i}`] : []))
    expect(blanks).toHaveLength(81 - 35)
    expect((await cellButtons(ui)).map(el => el.key)).toEqual(blanks)
  })
})

describe('開局後加入', () => {
  test('進行中加入的玩家是候補者', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    postAs(service, '/start', { credential: host, difficulty: 'easy' }, clock.now())
    await clock.advance(5000)
    expect(publicState(service, clock.now()).phase).toBe('playing')
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: 'Later' })

    expect(await ui.find({ type: 'Text', text: '你是候補者，等待下一局' })).toBeDefined()
    expect(await cellButtons(ui)).toHaveLength(0)
  })

  test('倒數期間加入的玩家是候補者', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    const service = createService('instance-1', { newCredential: credentials(), hostKey: 'key' })
    const host = (JSON.parse(postAs(service, '/join', { nickname: 'Host', hostKey: 'key' }).text) as { credential: string })
      .credential
    postAs(service, '/start', { credential: host, difficulty: 'easy' }, clock.now())
    routeFetch(on, service, { isDown: false }, clock)
    await run($, 'join http://test:47900')
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: 'Late' })

    expect(await ui.find({ type: 'Text', text: '你是候補者，等待下一局' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '候補者（1）' })).toBeDefined()
  })
})

describe('玩家憑證', () => {
  test('同一個 session 對同一個共同服務再加入一次，沿用原本的身分，不會多出一位玩家', async ($, on) => {
    stubEngine(on)
    routeFetch(on, newService())
    await run($, 'join http://test:47900')
    const ui = await mountPane($)
    await ui.input({ key: 'nickname', text: 'Alice' })

    await run($, 'join http://test:47900')

    expect(await ui.find({ type: 'Text', text: '你是 Alice' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'nickname' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '玩家（1）' })).toBeDefined()
  })
})

describe('房主身分', () => {
  test('房主以啟動時交給共同服務的密鑰加入，名單標示房主；沒有密鑰的人不是房主', async ($, on) => {
    stubEngine(on)
    const clock = mock.clock(on)
    // 共同服務在 spawn 時才拿到房主密鑰（環境變數），所以核心在 spawn hook 裡建立
    const holder: { service: Service | null } = { service: null }
    routeFetch(on, { handle: request => holder.service!.handle(request) })
    on('process.spawn', async function* (_$, e) {
      holder.service = createService('instance-1', {
        newCredential: credentials(),
        hostKey: e.env?.SUDOKU_ONLINE_HOST_KEY ?? '',
      })
      yield { stream: 'stdout' as const, text: '{"port":47900,"addresses":["192.168.1.5"]}\n' }
      await clock.sleep(24 * 60 * 60 * 1000)

      return { value: { code: 0, signal: null } }
    })
    await run($, 'host')
    await clock.settle()
    const ui = await mountPane($)

    await ui.input({ key: 'nickname', text: 'Host' })
    expect(await ui.find({ type: 'Text', text: '你是 Host（房主）' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Host（房主）' })).toBeDefined()

    joinAs(holder.service!, 'Bob')
    await clock.advance(1000)
    expect(await ui.find({ type: 'Text', text: '・Bob' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '・Bob（房主）' })).toBeUndefined()
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
