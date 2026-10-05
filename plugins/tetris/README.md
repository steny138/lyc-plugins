# tetris

Claude Code CLI 終端內的獨立單機俄羅斯方塊 mod，移植自 samtay/tetris。與 sudoku、sudoku-online 分開。

## 安裝與開啟

```sh
claude plugin install tetris@lyc-plugins
```

開發時可從專案根目錄直接載入：

```sh
claude --plugin-dir ./plugins/tetris
```

輸入 `/tetris` 開啟；再次輸入會關閉可見面板。關閉再開沿用本 session 的局面。
點棋盤或按 `ctrl+x tab` 讓面板取得焦點；回到 Claude 輸入框後打字不操作遊戲。

| 按鍵 | 操作 |
|---|---|
| A / D | 左／右移一格 |
| W | 原版逆時針旋轉與左右一格修正；O 不旋轉，I 兩個方向 |
| S | 下移一格 |
| F | 直接落底，下一重力 tick 才固定 |
| P | 手動暫停／繼續 |
| R | 重設本局；保留暫停狀態 |

按鈕亦可點選。落底鎖定期間不接受移動、旋轉、再落底或暫停；R 仍可重開。
離開焦點、縮小或關閉面板不會自動暫停，請先按 P。

## 規則與畫面

- 可見棋盤 10×20，每格占兩個終端欄位，固定方塊畫成 █、正在下落的方塊畫成 ▓，以顏色區別形狀，暫停時仍可辨認；空格為暗色 ·。
- 顯示下一塊的形狀、分數、累計消行與內部等級（從 0 開始）。
- 每袋 28 塊，每種四塊。消除 1／2／3／4 行得 40／100／300／1200 ×（固定前等級＋1）；落底與下移沒有額外分數。
- 每累計 10 行升一級，最高內部等級 15。原版重力公式為 `floor(400000 × 0.85^(2 × level))` 微秒，初始 400ms，等級 15 約 3ms；終端重畫可能略過中間畫面。
- 保留可見區上方的出生區；出生位置被堆疊阻擋、無法下落時遊戲結束。
- 面板至少需 22 欄；42 欄以上棋盤與資訊並排，需 20 列；36–41 欄直排需 31 列，22–35 欄需 34 列。空間不足時顯示尺寸提示（含目前欄列數與 dock／inline 擺放）與暫停／重開按鈕。終端 110 欄以上的 fullscreen 才會把面板 dock 在旁邊並取得整個高度，否則面板位於輸入框上方，高度受版面限制。Desktop 等不支援 Raster 的畫面會提示使用 CLI。
- 狀態僅保留於目前 session；`/clear`、resume 或 branch 後不承諾恢復本局。熱重載保留 session 狀態並恢復重力。

未加入保留方塊、落點影子、跨 session 最高分或多人功能。

## 驗證與來源

```sh
claude plugin validate plugins/tetris
claude plugin test plugins/tetris
npx -y -p typescript tsc -p plugins/tetris
```

型別檢查須先由目前 CLI 載入以生成 `.claude-plugin/types/`；使用包含 Uint8Array base64 型別的 TypeScript（本次使用 7.0.2）。測試從指令、按鈕、模擬時間與 Raster 畫面驗證完整 mod。

固定來源 revision 與 Sam Tay 的 MIT 授權見 [NOTICE](NOTICE.md)。
