/** 共同服務 `GET /state` 回傳的狀態 */
export type ServiceState = {
  /** 共同服務實例識別碼；每次啟動都不同 */
  instanceId: string
  count: number
}

/** 本機與共同服務的連線 */
export type Connection = {
  /** 共同服務位址，例如 `http://192.168.1.5:47900` */
  url: string
  /** 最後一次讀到的狀態；還沒讀到為 null */
  state: ServiceState | null
}

declare module 'claude-code' {
  interface PluginState {
    'sudoku-online': { connection: Connection | null }
  }
}
