/**
 * 共同服務核心：純函式，不碰 Node 也不碰引擎。
 * Node 外殼（server.ts）與引擎測試都把請求交給同一份 `handle`。
 */

export type Request = { method: string; path: string; body?: string }
export type Response = { status: number; text: string }
export type Service = { handle: (request: Request) => Response }

export type ServiceOptions = {
  /** 產生新的玩家憑證；Node 外殼傳 randomUUID，測試傳固定序列 */
  newCredential: () => string
  /** 房主密鑰：加入時帶上相同密鑰的人是房主；空字串表示沒有人能成為房主 */
  hostKey?: string
}

/** 共同服務記得的一位玩家；credential 只回給本人，不出現在公開狀態 */
type Player = { credential: string; nickname: string; isHost: boolean }

/** 暱稱長度上限，為了面板名單排版 */
const MAX_NICKNAME = 12

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

export const createService = (instanceId: string, { newCredential, hostKey = '' }: ServiceOptions): Service => {
  const players: Player[] = []

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
    const known = players.find(player => player.credential === body.credential)
    if (known) return json(200, known)
    const wanted = typeof body.nickname === 'string' ? body.nickname.trim() : ''
    if (wanted === '') return json(400, { error: '請輸入暱稱' })
    // 以 Unicode 字元計算，中文一字算一個
    if ([...wanted].length > MAX_NICKNAME) return json(400, { error: `暱稱最多 ${MAX_NICKNAME} 個字` })
    const isHost = hostKey !== '' && body.hostKey === hostKey
    const player: Player = { credential: newCredential(), nickname: uniqueNickname(wanted), isHost }
    players.push(player)

    return json(200, player)
  }

  return {
    handle: ({ method, path, body }) => {
      if (method === 'GET' && path === '/state') {
        return json(200, { instanceId, players: players.map(({ nickname, isHost }) => ({ nickname, isHost })) })
      }
      if (method === 'POST' && path === '/join') return join(parseBody(body))

      return json(404, { error: 'not found' })
    },
  }
}
