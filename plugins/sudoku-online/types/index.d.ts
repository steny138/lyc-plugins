/** 名單上的一位玩家（公開資訊，不含玩家憑證） */
export type PlayerSummary = { nickname: string; isHost: boolean }

/** 共同服務 `GET /state` 回傳的狀態 */
export type ServiceState = {
  /** 共同服務實例識別碼；每次啟動都不同 */
  instanceId: string
  players: PlayerSummary[]
}

/** 本機玩家在共同服務上的身分；`POST /join` 回傳 */
export type Me = {
  /** 玩家憑證：之後每個請求都帶上，用來認出同一位玩家 */
  credential: string
  /** 共同服務確認後的暱稱（重複時已加後綴） */
  nickname: string
  isHost: boolean
}

/** 本機與共同服務的連線 */
export type Connection = {
  /** 共同服務位址，例如 `http://192.168.1.5:47900` */
  url: string
  /** 最後一次讀到的狀態；還沒讀到為 null */
  state: ServiceState | null
  /** 最後一次請求是否連上共同服務 */
  isConnected: boolean
  /** 位址上已換成另一個共同服務實例：原局已失效，要重新加入 */
  isExpired: boolean
  /** 本機玩家的身分；還沒輸入暱稱加入為 null */
  me: Me | null
  /** 共同服務拒絕加入的原因（例如暱稱不合規）；沒有被拒絕為 null */
  joinError: string | null
}

/** 房主啟動的共同服務子程序 */
export type Hosting =
  | { status: 'starting' }
  /**
   * shareUrls：給同區網玩家連線的位址；房主電腦有幾個區網 IPv4 就有幾個。
   * localUrl：房主自己連線用的本機位址；hostKey：啟動時交給共同服務的房主密鑰
   */
  | { status: 'running'; shareUrls: string[]; localUrl: string; hostKey: string }
  | { status: 'failed'; reason: string }
  /** 房主主動停止（例如關閉面板） */
  | { status: 'stopped'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'sudoku-online': { connection: Connection | null; hosting: Hosting | null }
  }
}
