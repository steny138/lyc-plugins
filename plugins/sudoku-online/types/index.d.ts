/** 本局進行到哪裡：lobby 等待準備、countdown 倒數、playing 進行中 */
export type Phase = 'lobby' | 'countdown' | 'playing'

/** participant：本局參賽者；candidate：候補者，等下一局 */
export type Role = 'participant' | 'candidate'

/** 名單上的一位玩家（公開資訊，不含玩家憑證） */
export type PlayerSummary = {
  nickname: string
  isHost: boolean
  isReady: boolean
  role: Role
}

/** 共同服務 `GET /state` 回傳的狀態 */
export type ServiceState = {
  /** 共同服務實例識別碼；每次啟動都不同 */
  instanceId: string
  phase: Phase
  /** 倒數時距離正式開始還有幾毫秒（以共同服務的時間計） */
  startsInMs?: number
  /** 進行中才有：本局難度 */
  difficulty?: Difficulty
  /** 進行中才有：本局題目，81 字元，`.` 為空格 */
  puzzle?: string
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
  /** 共同服務拒絕最近一次操作（準備、開局、移出）的原因；沒有被拒絕為 null */
  actionError: string | null
}

/** 開局可選的難度 */
export type Difficulty = 'easy' | 'medium' | 'hard'

/** 本機作答中的盤面；只在自己的 session，不送給共同服務 */
export type Board = {
  /** 這份盤面屬於哪一道題；共同服務換題（下一局）時據此重來 */
  puzzle: string
  /** 目前盤面（含題目），81 字元，`.` 為空格 */
  cells: string
  /** 選取中的格子索引；沒有選取為 null */
  selected: number | null
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
    'sudoku-online': { connection: Connection | null; hosting: Hosting | null; board: Board | null }
  }
}
