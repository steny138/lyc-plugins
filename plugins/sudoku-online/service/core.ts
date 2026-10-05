/**
 * 共同服務核心：純函式，不碰 Node 也不碰引擎。
 * Node 外殼（server.ts）與引擎測試都把請求交給同一份 `handle`；需要時間的地方由呼叫端傳入 `now`。
 */

import type { Difficulty, Phase, Role } from '../types'
import { generate } from './sudoku.ts'

export type Request = { method: string; path: string; body?: string }
export type Response = { status: number; text: string }
export type Service = { handle: (request: Request, now?: number) => Response }

export type ServiceOptions = {
  /** 產生新的玩家憑證；Node 外殼傳 randomUUID，測試傳固定序列 */
  newCredential: () => string
  /** 房主密鑰：加入時帶上相同密鑰的人是房主；空字串表示沒有人能成為房主 */
  hostKey?: string
  /** 出題用的亂數；預設 Math.random，測試傳固定種子讓題目可以重現 */
  random?: () => number
}

/** 共同服務記得的一位玩家；credential 只回給本人，不出現在公開狀態 */
type Player = { credential: string; nickname: string; isHost: boolean; isReady: boolean; role: Role }

/** 各難度的題目提示數（沿用 sudoku：44／35／26） */
const CLUES: Record<Difficulty, number> = { easy: 44, medium: 35, hard: 26 }
const DIFFICULTIES = Object.keys(CLUES) as Difficulty[]

/** 暱稱長度上限，為了面板名單排版 */
const MAX_NICKNAME = 12
/** 房主開局後到正式開始的倒數（spec：5 秒） */
const COUNTDOWN_MS = 5000

const json = (status: number, value: unknown): Response => ({ status, text: JSON.stringify(value) })

/** 讀 JSON body；格式不對時當成空物件，交給各欄位的檢查處理 */
const parseBody = (body: string | undefined): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(body ?? '{}')

    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** 回給本人的身分 */
const identity = ({ credential, nickname, isHost }: Player) => ({ credential, nickname, isHost })

export const createService = (
  instanceId: string,
  { newCredential, hostKey = '', random = Math.random }: ServiceOptions,
): Service => {
  const players: Player[] = []
  /** 本局：開局前為 null；開局後記下編號、難度、題目、答案、正式開始的時間，以及房主是否已結束本局 */
  let round: {
    id: number
    difficulty: Difficulty
    puzzle: string
    solution: string
    startsAt: number
    isEnded: boolean
  } | null = null
  /** 上一次開局用的編號；每次開局加一 */
  let lastRoundId = 0
  /** 本局已完成者，依共同服務收到正確提交的順序排列 */
  let ranking: { credential: string; nickname: string; rank: number; elapsedMs: number }[] = []

  /** 依現在時間判斷本局階段；倒數時間到就算進行中，房主結束後為已結束 */
  const phaseAt = (now: number): Phase =>
    round === null ? 'lobby' : round.isEnded ? 'ended' : now < round.startsAt ? 'countdown' : 'playing'

  /** 依玩家憑證找人；找不到為 undefined */
  const byCredential = (credential: unknown) => players.find(player => player.credential === credential)

  /** 這個玩家憑證是不是房主的；房主操作（開局、移出）都要先過這一關 */
  const isHost = (credential: unknown) => byCredential(credential)?.isHost === true

  /** 和別人重複時依序加上 #2、#3…，直到沒有人用 */
  const uniqueNickname = (wanted: string) => {
    const taken = new Set(players.map(player => player.nickname))
    if (!taken.has(wanted)) return wanted
    let n = 2
    while (taken.has(`${wanted}#${n}`)) n += 1

    return `${wanted}#${n}`
  }

  const join = (body: Record<string, unknown>): Response => {
    // 帶著已發出的玩家憑證：同一位玩家再加入，沿用原本的身分
    const known = byCredential(body.credential)
    if (known) return json(200, identity(known))
    const wanted = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    if (wanted === '') return json(400, { error: '請輸入暱稱' })
    // 以 Unicode 字元計算，中文一字算一個
    if ([...wanted].length > MAX_NICKNAME) return json(400, { error: `暱稱最多 ${MAX_NICKNAME} 個字` })
    const isHost = hostKey !== '' && body.hostKey === hostKey
    const player: Player = {
      credential: newCredential(),
      nickname: uniqueNickname(wanted),
      isHost,
      isReady: false,
      // 房主開局後（倒數或進行中）名單已固定，新加入的人等下一局
      role: round === null ? 'participant' : 'candidate',
    }
    players.push(player)

    return json(200, identity(player))
  }

  /** 參賽者在大廳表示準備或取消準備 */
  const ready = (body: Record<string, unknown>, now: number): Response => {
    const player = byCredential(body.credential)
    if (!player) return json(403, { error: '不認得這位玩家' })
    if (phaseAt(now) !== 'lobby' || player.role !== 'participant') return json(409, { error: '現在不能改變準備狀態' })
    player.isReady = body.isReady === true

    return json(200, { isReady: player.isReady })
  }

  /** 房主選難度開局：除了房主以外的參賽者都要已準備 */
  const start = (body: Record<string, unknown>, now: number): Response => {
    if (!isHost(body.credential)) return json(403, { error: '只有房主可以開局' })
    if (phaseAt(now) !== 'lobby') return json(409, { error: '本局已經開始' })
    const difficulty = DIFFICULTIES.find(d => d === body.difficulty)
    if (!difficulty) return json(400, { error: '請選擇難度' })
    const notReady = players.filter(p => p.role === 'participant' && !p.isHost && !p.isReady)
    if (notReady.length > 0) return json(409, { error: `還有玩家沒準備：${notReady.map(p => p.nickname).join('、')}` })
    // 從這一刻起參賽名單固定；題目現在就出好，但倒數結束前不公開
    const { puzzle, solution } = generate(CLUES[difficulty], random)
    lastRoundId += 1
    round = { id: lastRoundId, difficulty, puzzle, solution, startsAt: now + COUNTDOWN_MS, isEnded: false }

    return json(200, { startsInMs: COUNTDOWN_MS })
  }

  /** 房主把大廳中未準備的參賽者移出本局，讓他成為候補者 */
  const remove = (body: Record<string, unknown>, now: number): Response => {
    if (!isHost(body.credential)) return json(403, { error: '只有房主可以移出玩家' })
    const target = players.find(p => p.nickname === body.nickname)
    if (phaseAt(now) !== 'lobby' || !target || target.isHost || target.role !== 'participant' || target.isReady) {
      return json(409, { error: '只能移出還沒準備的參賽者' })
    }
    target.role = 'candidate'

    return json(200, { nickname: target.nickname, role: target.role })
  }

  /** 參賽者提交填完的盤面；名次依共同服務收到的順序，用時從正式開始算到收到這一刻 */
  const submit = (body: Record<string, unknown>, now: number): Response => {
    const player = byCredential(body.credential)
    if (!player) return json(403, { error: '不認得這位玩家' })
    if (player.role !== 'participant') return json(409, { error: '候補者不能提交' })
    if (phaseAt(now) === 'ended') return json(409, { error: '本局已結束' })
    if (round === null || phaseAt(now) !== 'playing') return json(409, { error: '本局還沒開始' })
    // 上一局（或別的局）的盤面不算進這一局
    if (body.roundId !== round.id) return json(409, { error: '這份盤面不屬於本局' })
    // 已經完成的人再送一次（例如重送）：回原本的名次，不重複計算
    const done = ranking.find(entry => entry.credential === player.credential)
    if (done) return json(200, { rank: done.rank, elapsedMs: done.elapsedMs })
    // 題目只有一個解，所以等於本局答案就同時保證：81 格都是 1–9、題目數字沒改、沒有衝突。
    // 不能只看填滿且沒有衝突（spec「答案驗證」）：那樣改了題目數字的盤面也會過
    if (body.cells !== round.solution) return json(400, { error: '盤面不正確' })
    const entry = { credential: player.credential, nickname: player.nickname, rank: ranking.length + 1, elapsedMs: now - round.startsAt }
    ranking.push(entry)

    return json(200, { rank: entry.rank, elapsedMs: entry.elapsedMs })
  }

  /** 房主結束進行中的本局：之後不再接受提交，未完成的參賽者沒有名次 */
  const end = (body: Record<string, unknown>, now: number): Response => {
    if (!isHost(body.credential)) return json(403, { error: '只有房主可以結束本局' })
    if (round === null || phaseAt(now) !== 'playing') return json(409, { error: '本局不在進行中' })
    round.isEnded = true

    return json(200, { phase: 'ended' })
  }

  /** 公開狀態：倒數時附上還剩多久 */
  const state = (now: number) => {
    const phase = phaseAt(now)

    return {
      instanceId,
      phase,
      ...(round ? { roundId: round.id } : {}),
      ...(round && phase === 'countdown' ? { startsInMs: round.startsAt - now } : {}),
      // 題目只在正式開始後公開（spec「公開題目」）；結束後仍公開，讓玩家看著自己的盤面與名次
      ...(round && (phase === 'playing' || phase === 'ended')
        ? {
            difficulty: round.difficulty,
            puzzle: round.puzzle,
            ranking: ranking.map(({ nickname, rank, elapsedMs }) => ({ nickname, rank, elapsedMs })),
          }
        : {}),
      players: players.map(({ nickname, isHost, isReady, role }) => ({ nickname, isHost, isReady, role })),
    }
  }

  return {
    handle: ({ method, path, body }, now = 0) => {
      if (method === 'GET' && path === '/state') return json(200, state(now))
      if (method === 'POST' && path === '/join') return join(parseBody(body))
      if (method === 'POST' && path === '/ready') return ready(parseBody(body), now)
      if (method === 'POST' && path === '/start') return start(parseBody(body), now)
      if (method === 'POST' && path === '/remove') return remove(parseBody(body), now)
      if (method === 'POST' && path === '/submit') return submit(parseBody(body), now)
      if (method === 'POST' && path === '/end') return end(parseBody(body), now)

      return json(404, { error: 'not found' })
    },
  }
}
