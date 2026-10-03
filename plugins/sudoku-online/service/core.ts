/**
 * 共同服務核心：純函式，不碰 Node 也不碰引擎。
 * Node 外殼（server.ts）與引擎測試都把請求交給同一份 `handle`；需要時間的地方由呼叫端傳入 `now`。
 */

export type Request = { method: string; path: string; body?: string }
export type Response = { status: number; text: string }
export type Service = { handle: (request: Request, now?: number) => Response }

export type ServiceOptions = {
  /** 產生新的玩家憑證；Node 外殼傳 randomUUID，測試傳固定序列 */
  newCredential: () => string
  /** 房主密鑰：加入時帶上相同密鑰的人是房主；空字串表示沒有人能成為房主 */
  hostKey?: string
}

/** 參賽者在本局有名額；候補者等下一局 */
type Role = 'participant' | 'candidate'

/** 共同服務記得的一位玩家；credential 只回給本人，不出現在公開狀態 */
type Player = { credential: string; nickname: string; isHost: boolean; isReady: boolean; role: Role }

/** 本局進行到哪裡：等待準備、倒數、進行中 */
type Phase = 'lobby' | 'countdown' | 'playing'

/** 開局可選的難度 */
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

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

export const createService = (instanceId: string, { newCredential, hostKey = '' }: ServiceOptions): Service => {
  const players: Player[] = []
  /** 本局：開局前為 null；開局後記下難度與正式開始的時間 */
  let round: { difficulty: Difficulty; startsAt: number } | null = null

  /** 依現在時間判斷本局階段；倒數時間到就算進行中 */
  const phaseAt = (now: number): Phase => (round === null ? 'lobby' : now < round.startsAt ? 'countdown' : 'playing')

  /** 依玩家憑證找人；找不到為 undefined */
  const byCredential = (credential: unknown) => players.find(player => player.credential === credential)

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
      role: 'participant',
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
    const player = byCredential(body.credential)
    if (!player?.isHost) return json(403, { error: '只有房主可以開局' })
    if (phaseAt(now) !== 'lobby') return json(409, { error: '本局已經開始' })
    const difficulty = DIFFICULTIES.find(d => d === body.difficulty)
    if (!difficulty) return json(400, { error: '請選擇難度' })
    const notReady = players.filter(p => p.role === 'participant' && !p.isHost && !p.isReady)
    if (notReady.length > 0) return json(409, { error: `還有玩家沒準備：${notReady.map(p => p.nickname).join('、')}` })
    // 從這一刻起參賽名單固定
    round = { difficulty, startsAt: now + COUNTDOWN_MS }

    return json(200, { startsInMs: COUNTDOWN_MS })
  }

  /** 公開狀態：倒數時附上還剩多久 */
  const state = (now: number) => {
    const phase = phaseAt(now)

    return {
      instanceId,
      phase,
      ...(round && phase === 'countdown' ? { startsInMs: round.startsAt - now } : {}),
      players: players.map(({ nickname, isHost, isReady, role }) => ({ nickname, isHost, isReady, role })),
    }
  }

  return {
    handle: ({ method, path, body }, now = 0) => {
      if (method === 'GET' && path === '/state') return json(200, state(now))
      if (method === 'POST' && path === '/join') return join(parseBody(body))
      if (method === 'POST' && path === '/ready') return ready(parseBody(body), now)
      if (method === 'POST' && path === '/start') return start(parseBody(body), now)

      return json(404, { error: 'not found' })
    },
  }
}
