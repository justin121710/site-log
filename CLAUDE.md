# 監造工地筆記（site-log）— 交接說明

本機路徑：`C:\Users\justi\site-log`
GitHub：`justin121710/site-log`（public）
線上：<https://justin121710.github.io/site-log/>
本機開發：`node tools/dev-server.mjs 5199`（零相依，不需要 npm install）

---

## 這是什麼、給誰用

使用者是**即將上工的土木監造工程師**，工作以**橋梁與水利結構為主**
（河川治理、水門抽水站溢洪道、匯排水箱涵管渠），偶爾有建築房舍。
這個 App 是他的**現場記錄 + 個人工項經驗庫**，裝在 iPhone 上（PWA，加到主畫面）。

兩種用法：

- **專案導向**：一個案場底下按日期記錄照片、錄音、逐字稿，收工前產出
  公共工程監造日報表（五段式）草稿。
- **工項導向**：同一件事在不同案場怎麼做，收在同一個工項底下，之後要設計時比對。

---

## 已鎖定的設計決策 — 不要重新提案

這些都是問過、辯論過、拍板的，不是還沒想到：

- **純前端 PWA、public repo、GitHub Pages、零外部相依**（連 ZIP 產生器、PNG 編碼、
  SVG path 解析都自己寫）。沒有後端、沒有帳號、沒有 build step。
- **Gemini API key 由使用者自己貼**，存在 IndexedDB，不進備份 zip。
- **備份 = 手動匯出 zip**，設定頁的「從備份還原…」把它讀回來（合併／完全取代兩種模式，
  匯入時使用者自己選）。走 iOS 分享選單。刻意不做自動雲端同步，
  因為 iOS 加到主畫面的 PWA 跑 OAuth 會被踢到 Safari 回不來。
  （這一條正在鬆動，見下方「待辦」。）
- **逐字稿預設走 iOS 鍵盤聽寫**（零外流），Gemini 轉檔是可選的第二條路。
- **照片預設永不上傳**；單張手動送 AI 的開關預設關閉。
- **工項分類固定 17 項一級 + 使用者可自訂**，一筆記錄可屬多個工項。
- **日報格式集中在 `js/report-template.js`**，等拿到公司制式表格只改那個檔。
- **提示文字已刻意精簡過**（84 段 → 29 段）。剩下的只有：錯誤訊息、
  法定表報段落標題、以及「資料真的要離開裝置那一刻」的四個警告。
  **不要再自己加說明文字。**

- **用 GPS 反查工址：評估過，2026-08-14 決定不做。** 不是做不到，是不划算——
  工址一個專案只選一次。已經量過的數字留著，不用再測一次：
  - 「最近的鄉鎮中心點」只有 **71.5%** 準（正解在前三名 92.8%），
    錯的集中在大面積山地鄉（秀林、仁愛、桃源），而河川治理常常就在那種地方。不能用。
  - 「0.005°（約 500m）格網查表」**97.0%** 準，錯的全在交界 250m 內，
    資料 63KB（gzip 後 17KB），純離線查表。可行，要做就做這個。
  - 地名對照：g0v twgeojson 的 377 個鄉鎮對得上 App 的 351 個，
    16 個是舊制名（桃園縣那批、頭份鎮、員林鎮）要對照表，金門烏坵鄉資料集沒有。
  - **不管哪個做法，都不打反向地理編碼 API**，那條界線沒有鬆動。

### AI 的界線（產品核心風險）

使用者是新人，**最沒有能力判斷 AI 在唬爛，而監造有法律責任**。所以：

- 所有 prompt 明確禁止模型補充工程見解或引用規範條號，只准整理他說過的話。
- 所有 AI 產出預設標「未查證」，勾「已確認」才進經驗庫可信層。
- 日報有一條**完全不用 AI 的本機草稿**路徑（依分類確定性分派到五段）。
- 設定頁有 **AI 總開關**，關掉之後整個 App 是純手動記錄本，功能不減。

---

## 架構

```
index.html            App 外殼（頂端列、底部兩個分頁、右上角設定+AI狀態）
sw.js                 service worker：程式碼 network-first + 強制驗證，圖示 cache-first
css/style.css
js/app.js             hash router
js/db.js              IndexedDB：settings/projects/days/entries/media/reports
js/taxonomy.js        17 項工項分類 + 自訂 + 舊 id 遷移
js/icons.js           28 個 SVG icon（currentColor，非 emoji）
js/twzones.js         台灣 22 縣市 / 368 鄉鎮市區（內建，不打反向地理編碼 API）
js/exif.js            從 JPEG 讀 GPS（只讀 GPS IFD）
js/glossary.js        工地術語錯字修正（純本機）+ 餵給 AI 的提示
js/laws.js            法規全文查詢（純查表，跟 AI 無關）
data/laws.json        法規包：12 部、1506 條，由 tools/make-laws.mjs 產生
data/specs.json       施工綱要規範章節索引：315 章（只有章碼章名，沒有內文）
js/gemini.js          Gemini 客戶端與所有 prompt、錯誤訊息對應
js/redact.js          代號替換與敏感詞掃描
js/confirm-upload.js  送出前預覽（可改可取消）
js/media.js           相機、錄音、GPS
js/watermark.js       浮水印（只在顯示與匯出時疊，原圖永遠乾淨）
js/zip.js             自寫 STORE-only ZIP（寫）
js/unzip.js           自寫 ZIP 讀取（讀，STORE + DEFLATE，用 file.slice 不吃記憶體）
js/restore.js         從備份 zip 還原（合併／完全取代）
js/export.js          備份與 Markdown 匯出（build* 只打包，export* 才送出分享）
js/export-all.js      一鍵全部匯出：報表＋備份＋Markdown 併成一批交給分享選單
js/export-ui.js       匯出對話框 + presentReport()
js/markdown.js        Markdown 產生
js/report-template.js 日報格式 + buildLocalDraft()（不用 AI 的分段）
js/report-html.js     六種可列印 HTML 報表
js/views/             各頁面
tools/make-icons.mjs  從 tools/logo.svg 產生 App 圖示
tools/make-laws.mjs   產生法規包（改完一定要 bump sw.js 的 CACHE，見下方坑）
tools/dev-server.mjs  本機靜態伺服器
tools/icon-preview.html  icon 預覽（開發用）
```

### 資料模型重點

- `entries.projectId` **可以是 null**（直接記在工項分類、不屬於任何案子）。
- `media` 有 `tag`（改正前/改正後/全景/近照/量測/材料）與 `caption`，
  施工照片表需要每張各自的圖說。
- `entries.defectNo` + `defectStatus`，同單號自動歸組成缺失追蹤表。
- `projects.site` = { county, district, village, address }，工地不會移動，
  所以行政區屬於專案而不是每張照片。

---

## 踩過的坑（不要重蹈）

- **原生 `Node.append()` 會把 `null` 印成字串 "null"**。用 `ui.js` 的 `append()`。
  `el()` 的 children 本來就會跳過 null。
- **iOS 相機直拍拿不到 GPS EXIF**（Apple 隱私設計），只有相簿選的才有。
  而且 `normalizePhoto()` 用 canvas 重編碼會砍掉 EXIF，所以要在縮圖**之前**讀。
- **`window.open()` 跨過 await 就會被當彈窗擋掉**。報表要先產生（非同步），
  所以必須給真的 `<a target="_blank">` 讓使用者自己點。
- **Gemini `AQ.` 開頭是 2026 年的新金鑰格式**，native endpoint 支援。
  免費層內容會被 Google 用於改善產品且可能人工審閱；付費層不會。
  預付額度歸零時該帳單帳戶下所有 key 同時停擺，**不會退回免費層**。
- **模型清單會過期**，設定頁有「抓取可用模型」會呼叫 Gemini 的 ListModels，
  直接用使用者那把 key 實際拿得到的清單，不要再寫死模型名稱。
- **測試連線分兩段**：先用 ListModels 驗 key（與模型無關），再驗模型。
  混在一起測會讓「模型退役」看起來像「key 壞掉」。
- **刪掉主畫面的 PWA 會清掉所有資料**。更新 App 不需要刪，直接重開即可。
- **`data/media-index.json` 要含 blob 以外的所有欄位**。原本只存 id/entryId/kind/mime/size，
  還原回來的照片就沒有 `tag` 與 `caption`，施工照片表會整份沒有圖說。
  2026-08-14 之前匯出的舊備份還原時就是這樣，救不回來。
- **還原不能碰 `geminiApiKey`**。備份裡本來就沒有 key，還原時把本機那把刪掉
  只會害使用者重貼一次。`restore.js` 兩種模式都會先接住再放回去。
- **法規包只收「法律與命令」**。著作權法第 9 條，法律、命令、公文不得為著作權
  之標的，所以整包放進 public repo 沒問題。**CNS 國家標準不行**（標準檢驗局有
  販售與授權限制）。這代表「保護層幾公分」在法規包裡查不到，別以為是壞掉了。
- **施工綱要規範的授權查過了：可以整包收，但目前只收索引。**
  工程會的「政府網站資料開放宣告」寫明所有資料與素材採「政府資料開放授權條款－
  第 1 版」，得無償重製、改作、公開傳輸，**使用時應註明出處**。
  2026-08-15 使用者選擇只做章節索引（章碼＋章名＋版次），不放全文，理由是
  **版本對應風險**：他案子適用的是招標當時那一版，而且主辦機關通常還會增修，
  那份增修版才是他要查驗的依據。要改做全文的話，授權這關是過的。
- **工程會那支查詢 API 的分頁參數在 POST body 裡**（`currentPage` 0 起算、`perPage`），
  放在 query string 會被無視，每一頁都回同一批。見 tools/make-specs.mjs。
- **更新法規包之後一定要 bump `sw.js` 的 CACHE**。`data/laws.json` 走 cache-first，
  不像程式碼有 network-first 兜底，不換版號就會一直用舊的那包。
  （排程 `.github/workflows/update-data.yml` 會自動 bump，手動跑工具時要自己記得。）
- **施工綱要規範沒有自動更新的路，三條都試過了，不要再花時間**（2026-08-15 實測）：
  1. **App 內按鈕直接抓** → `pcic.pcc.gov.tw` 不給 CORS。內部查詢 API（POST）
     過不了 preflight，官方開放資料端點（GET）也沒有 `Access-Control-Allow-Origin`。
  2. **GitHub Actions 排程** → 該主機擋境外 IP，TCP connect timeout，跟路徑無關。
  3. **政府資料開放平臺的替代來源**（dataset 26442「公共工程綱要編碼」）→
     那份 JSON 只是一個指向 PDF 的連結，停在 2021-06-08，也不是章節清單。
  結論：只能從台灣的網路手動跑 `node tools/make-specs.mjs` 再部署。
  查法規頁在索引超過 180 天沒更新時會出現提醒，不會讓人默默用著三年前的資料。
  （法規那半不受影響：鏡像在 raw.githubusercontent.com，CORS 與境外 IP 都通，
  所以有 App 內按鈕，也有每月排程。）
- **`pcic.pcc.gov.tw` 連不上境外 IP**。GitHub Actions 的機器在美國，實測三次重試、
  每次 30 秒逾時全部 connect timeout；同一支工具從台灣的網路跑完全正常。
  所以**法規可以每月自動更新，施工綱要規範不行**——規範改版時要從台灣手動跑
  `node tools/make-specs.mjs`。排程裡那一步是 `continue-on-error`，
  失敗只會在執行摘要留一行，不會拖垮法規那半。
  注意：`continue-on-error` 的步驟在 `gh run view --json jobs` 裡會顯示成 success，
  要看 `steps.<id>.outcome` 或執行摘要才知道它其實失敗了。
- **兩支 make-*.mjs 在內容相同時不會重寫檔案**。`builtAt`／`fetchedAt` 每次都不一樣，
  照寫的話排程每個月都會產生一次假變動，害所有裝置白白重抓 700KB。
- **service worker 預快取要用 `cache: 'reload'`**。少了它，install 會走瀏覽器自己的
  HTTP 快取，而 GitHub Pages 給 max-age=600——改版後十分鐘內裝進來的還是舊檔。
  程式碼有 network-first 看不出來，法規包會直接中獎。
- **AI 產出一律是「・」開頭的條列**（`tidyAndExtract` 的 tidied 與日報五段都是）。
  接收端三個地方要配合：報表表格與照片圖說要 `white-space: pre-wrap`（不然 HTML 把換行
  併成一整段），Markdown 要把「・」換成「- 」（Notion 不認得「・」），
  `buildLocalDraft()` 要**逐行**分派到五段——整筆丟的話同樣的八行會在三段各印一次。
- **iOS PWA 底部有一條 62pt 的死區，只有重新加到主畫面才會消失**（2026-08-15 查清）。
  症狀：啟動後底部分頁列上方有色差，碰螢幕一下才「歸位」。實機量到的數字：
  螢幕 874、視窗 812、上緣 safe-area 62、下緣 34，而 `874 − 812 = 62`——
  iOS 用「螢幕高減狀態列」算 web view 高度，卻同時又套 `viewport-fit=cover` 的
  inset，於是網頁靠上對齊、底部空出一條 web view 以外的死區。
  啟動當下與觸控之後兩組數字**完全相同**，證明錯位不在網頁座標系裡。
  - **修法已經在 `index.html`**：`apple-mobile-web-app-status-bar-style` 從
    `black-translucent` 改成 `black`。但**那個 meta 是 iOS 在「加到主畫面」當下
    讀取並寫死的**，已經裝好的 PWA 不會因為伺服器上的 HTML 改了就生效。
    使用者下次重裝（換手機、或先匯出備份再重加）時會自動好。
  - **試過但無效，不要再試**：強制重排／挪 `bottom` 校正、`#tabbar::after` 墊同色
    背景、把 `html` 的畫布染成分頁列顏色。那塊是 iOS 自己畫的，網頁碰不到。
- **返回鍵不能用 `history.back()`**。存完記錄會把「回到那天」推進歷史，
  back 等於再走回剛剛在編輯的頁面。改成依網址算上一層（`ui.js` 的 `setBack()`），
  結束一個頁面時用 `location.replace()`，iOS 側滑返回才不會也掉回去。
- **部署**：`git push` 本身就會觸發 Pages 建置，**不要再手動 POST /pages/builds**，
  兩個請求會互相取消，在 Actions 上看起來像失敗。

---

## 目前狀態

功能都完成並在正式網址驗證過：專案/記錄/照片/錄音/聽寫、17 項工項分類、
缺失追蹤、六種 HTML 報表（日報、施工照片表、期間報表、缺失追蹤表、
工項彙整、專案完整本）、備份 zip、從備份還原、Markdown 匯出、AI 總開關、
本機日報草稿、一鍵全部匯出。

使用者的 Gemini 預付額度已用完，**目前 AI 是關閉狀態**，用純手動流程。

---

## 待辦：雲端備份（OneDrive）

使用者要把報表與資料快速丟上 OneDrive，方便從電腦讀取。
**已經拷問過，結論如下，不要重新討論這些前提：**

### 已確認的事實

- 使用者**知道**「分享 → 儲存到檔案 → OneDrive」現在就能用，
  他要的是**少按幾下**，不是可行性。
- 用的是**個人 Microsoft 帳號**（不是公司 M365）。
- 要同步的東西：**報表 HTML、完整備份 zip、照片原檔（依專案/日期分資料夾）、Markdown**。
- **iOS PWA 不能在背景執行**，所以自動化的天花板是
  「打開 App 按一下」而不是「完全不用管」。使用者已知並接受。

### 實作順序

**第一步：一鍵全部匯出 —— 已完成（`js/export-all.js`）**

匯出對話框最上面那顆按鈕，三個入口（某一天／專案／設定的全部資料）共用。
決定過的細節：

- 報表依範圍挑：某一天 → 監造日報；一個專案 → 完整本＋缺失追蹤表（有單號才有）；
  全部 → 每個有記錄的專案各一套。沒歸專案的記錄沒有報表（報表都以專案為單位），
  但備份與 Markdown 收得到。
- 那天還沒產過日報就用 `buildLocalDraft()` 現做一份，**不呼叫 AI，也不寫回 reports**——
  一鍵匯出不該偷改他存的日報。
- **多檔一次分享**：`shareFiles()` 先試 `navigator.share({ files: [...] })` 送三個檔，
  iOS 的「儲存到檔案」會把整批存進同一個資料夾。分享選單吃不下（桌機、舊 iOS）
  才退回打包成一個 zip 再分享一次，反正仍然是「按一次」。
- 報表照片超過 300 張就整批不附照片（data URI 會在手機上爆記憶體），
  狀態列會講，原圖照樣一張不少在同批的備份 zip 裡。
- 使用者在分享選單按取消時 **不會**更新「上次備份時間」，首頁的備份提醒才不會被騙過去。

先讓他用一陣子，看夠不夠。

**第二步（如果還是嫌麻煩才做）：OneDrive 串接**

- Microsoft Graph **支援 CORS**，純前端打得到（跟 Notion 不同）。
- 需要使用者自行到 Azure Portal 註冊一個 SPA 應用取得 client ID。
- 授權用 Authorization Code + PKCE，**不要引入 MSAL.js**（違反零相依），
  自己實作約 150 行。
- **主要風險：standalone PWA 的 OAuth 導回可能跑到 Safari，PWA 收不到 token。**
  使用者已指定退路：**改用裝置碼流程（device code flow）**，
  App 顯示一組碼，使用者在別的地方輸入授權，不依賴導回。
- 大檔要用 Graph 的 upload session 分塊上傳。
- 資料夾結構建議沿用備份 zip 的那一套：`專案/日期/`。

### 要提醒使用者的取捨

手動匯出時他每次都看得到自己送了什麼；改成一鍵全傳之後就不會再看第二眼。
個人 OneDrive 跟先前建議的 iCloud 是同一個層級（消費級個人雲端），
所以這不是隱私上的退步——**真正改變的是「每次都經過他眼睛」這件事消失了**。
這一點講一次就好，他已經知道並接受，不要反覆勸阻。
