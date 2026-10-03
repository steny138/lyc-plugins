# 共同服務是房主 mod 以 `$.process.spawn` 啟動的 Node 子程序，與 mod 同生同死

mod 執行環境沒有 Node，也沒有監聽 port 的 API，只能透過 `$.http.fetch` 對外連線，所以 sudoku-online 的共同服務必須是一支獨立的 Node 程式，由房主的 mod 用 `$.process.spawn` 一鍵啟動（引擎 2.1.288 型別，`claude-code.d.ts:20`、`:3308-3345`）。引擎會在 spawn 迴圈結束或模組卸載時終止子程序。我們接受這個行為：房主 session 結束、熱重載或 plugin 更新時，共同服務與本局一起中止；重新啟動的是新的服務實例，舊客戶端依服務實例識別碼判定原局已失效。

## Considered Options

- **讓共同服務脫離 mod 在背景常駐（nohup 等）**：房主重載不會中斷本局，但需要自行管理 PID、停止方式、孤兒程序清理，以及房主重開 session 後如何重新接管。這些都超出朋友間競速的範圍，因此不採用。
- **在 mod 內直接當 server**：引擎不提供這個能力。

## Consequences

- 只有 CLI 能當房主（`$.process` 標示為 CLI only）。為了讓範圍一致，玩家也只支援 CLI。
- 房主電腦需要安裝 Node；沒有安裝時，一鍵啟動要顯示失敗狀態。
- 共同服務的核心寫成不依賴 Node 的處理函式，Node 只負責 HTTP 外殼，讓引擎測試能透過 `http.fetch` hook 跑完整局對戰。
