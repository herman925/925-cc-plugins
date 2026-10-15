# Orca 原生 Team Orchestrator：宿主契約與跨平台研究

研究日期：2026-10-15。研究票：[Orca spec：官方插件宿主契約與跨平台能力](https://github.com/herman925/925-cc-plugins/issues/96)。所屬地圖：[Map: Orca 原生 Team Orchestrator 開發 spec](https://github.com/herman925/925-cc-plugins/issues/95)。發起者：Lin。

本文件提供後續開發 spec 的事實與路線條件，**不代表已選定最低 Orca 版本、是否等待 upstream、是否保留注入相容層或混合團隊政策**。用語依照 [GLOSSARY](../../GLOSSARY.md)：產品是安裝在 Orca ADE 的原生插件；Claude Code、Codex 是宿主管理的 agent，不是本插件的宿主。macOS 與 Windows 必須是同一產品能力契約的驗收對象。

## 結論與證據等級

**主要缺口是公開插件契約，並非只缺一個 macOS 檔案定位修正。** 在查驗的兩個官方 commit，panel 只能呼叫 `workspace.readContext`、`terminal.sendText`、`notifications.show`；worker 可存取較多 host 方法，但也沒有公開的 agent 啟動、發現、命名、取消方法，panel 亦無公開通道呼叫自身 worker command。官方把這一整套 API 標為 experimental，尚不能稱為已凍結的穩定 SDK。[公開方法全集][host-api]

Orca 自己已有 agent 發現、依設定決定 Chat／terminal 的統一啟動器、會話取消、編排與終端控制。這些能力位於 **Orca CLI 或內部 runtime**；存在於宿主不等於已授權給 plugin。後續可把所需能力接到受控插件門面，讓團隊業務邏輯只處理成員、工作區、任務與回執，而由 Orca 處理 provider／執行宿主差異。[agent 發現][preflight]、[統一啟動][launch-intent]、[會話生命週期][sessions]

本文標記：**源碼事實**＝在指定 commit 可直接讀到；**前次實測**＝沿用已保存的本機只讀檢查，未在本研究重做；**推論／提案**＝由事實導出的 spec 輸入，並非現有 API；**未驗證**＝沒有足以承諾產品可用的端到端證據。本次沒有修改／注入已安裝 Orca、啟動 agent 或實作插件功能。

## 版本與可追溯性

| 證據對象 | 固定版本 | 可以證明的範圍 |
| --- | --- | --- |
| 官方研究時 main | `02356732b0a4b8fa46aefead303f6f092611c18d` | 本文件 `[源碼事實]` 的預設版本；所有官方原始碼引文固定此 SHA |
| 前次本機 macOS 安裝包 | `1.4.222`，`9fdd90ffa7721e145f1353ad9fb9df2f70c31f43` | 來自 [前次實測報告](../team-orchestrator-orca-analysis.md)；不以 package 版本號推斷 commit 順序 |
| 本倉庫原型 | 基底 `b36f3be`，插件顯示 `0.1.06` | panel／worker／adapter 實作；相對連結隨本研究分支固定 |
| 線上官方文檔 | 本次開啟 [Settings reference](https://www.onorca.dev/docs/settings) | 使用者入口與 experimental 說明；技術斷言以固定 SHA 原始碼為準 |

本次 `git diff` 確認兩個 Orca commit 的 `plugin-host-api.ts`、manifest、events、worker runtime／process 內容一致；不是宣稱整個插件子系統完全相同。特別校正容易混淆之處：`src/cli/specs/agent-launch.ts`、`src/cli/agent-launch-request.ts` **僅在研究 main 存在**，但內部 `src/main/runtime/rpc/methods/agent-launch.ts` **兩個 commit 皆存在、內容不同**。因此舊安裝包「CLI 沒有 agent launch」不能改寫成「Orca 內部沒有統一啟動器」。以上檔案存在性均以 `git cat-file -e <SHA>:<path>` 核對。[CLI 規格][launch-cli]、[runtime 啟動器][launch-runtime]

## 宿主能力矩陣

下表是 `[源碼事實]`。公開指插件門面已列出的方法，不保證 experimental API 永不改變。

| 能力 | Panel 公開 API | Worker 公開 SDK／host API | 其他 Orca 層及對 spec 的影響 |
| --- | --- | --- | --- |
| 呼叫自身 command | 無 | `commands.register` 只註冊 handler；不是呼叫任意 runtime 的入口 | 主程式 `invokeCommand` 會檢查已啟用、manifest command 並 lazy-start worker；尚無受控 panel 對接。[SDK][worker-runtime]、[command service][plugin-service] |
| 開啟與激活 | 讀取 HTML、綁定 panel session | command 或 manifest 訂閱事件可觸發激活 | 打開 panel 的 load 路徑不 ensure worker；不能用「看得到面板」判定已連線。[panel controller][panel-controller]、[事件激活][event-delivery] |
| 工作區展示 | `workspace.readContext` | 同名方法 | 僅 branch、displayName、最多 50 個 terminal id，或 null；不回傳可作 durable identity 的 workspace／host token。[schema][host-api] |
| 工作區與執行宿主 identity | 無完整可信 identity | 同左 | host binding 刻意移除帶 provider path 的內部 worktreeId；事件中的 worktreeId 也不等於呼叫當下由宿主綁定的選中工作區。[projection][host-bindings]、[事件內容][events] |
| Agent 發現與可用能力 | 無 | 無 | runtime `preflight.detectAgents` 按 workspace 解析 native／WSL／SSH 檢測位置；插件不能直接把方法名稱傳入 `host.call`。[發現邊界][preflight] |
| Agent 建立與初始 prompt | 無 | 無 | 新 main 的 `orca agent launch`／內部 `agent.launch` 使用宿主路由；結果可能是 structured 或 terminal，須讀 receipt。[CLI][launch-cli]、[結果型別][launch-intent] |
| Tab／會話命名 | 無 | 無 | `orca terminal rename --terminal <handle>` 有文件；runtime 命名方法更新 PTY／tab。尚未證明每種 structured session handle 都可由同一命令命名，不能把 terminal 契約直接當成完整 native-chat 契約。[CLI 參考][cli-reference]、[命名實作][rename] |
| 現有終端輸入 | `terminal.sendText` | 同名方法 | 須指定 terminalId，送出前重查是否仍屬 active worktree；`accepted` 只證明輸入路由接受，無任務完成含義。[binding][host-bindings] |
| 狀態訂閱 | 無 events API | `events.on`／`events.subscribe` | 只有 worktree.created、worktree.removed、agent.status.changed；沒有公開初始狀態 snapshot／重播 cursor／團隊 task stream。[manifest][manifest]、[events][events] |
| 持久化 | 無 | `storage.*`、`settings.*`、`secrets.*` | 以 plugin key 隔離，存於當前 Orca profile 的 pluginsDataDir；非預設按 workspace 隔離或自動跨機同步。[store binding][service-bindings] |
| 權限與身份 | session token、owner、manifest／consent 檢查 | 每次 host call 重新 gate；SDK grantedCapabilities 只是資訊 | 插件增加 `main` 即跨入 trusted Node worker 信任邊界，fingerprint 會改；七種 capability 限的是宿主 API，並非 Node 程式的 OS sandbox。[consent][consent]、[capabilities][capabilities]、[worker process][worker-process] |
| 取消／關閉 | 無任務或 agent stop API | 無公開 agent cancel／close | 內部 `agentSession.cancel` 與 `close` 意義不同；CLI terminal close 會停止並移除終端。`worker-stop`／`worker-release` 另有編排所有權語義，不能互換。[sessions][sessions]、[terminal 文件][cli-reference]、[編排文件][orchestration] |

宣告 `contributes.agents` 只提供內容貢獻，不能為上述缺失方法增加權限；capability 是封閉集合，填入自創 `agent:launch` 不會生成 API。[manifest][manifest]、[capabilities][capabilities]

## Panel、worker 與執行層的邊界

### Panel 不應承擔 native／CLI 適配

`[源碼事實]` Panel 被放進 sandboxed iframe，CSP 是 `connect-src 'none'`，只走宿主的受限 action bridge；不能把 localhost HTTP／WebSocket 當作既有受支持的直連替代品。`workspace.readContext` 的參數是嚴格空物件，現有 `{ teamWorker: ... }` envelope 在沒有 adapter 時會被拒絕。[CSP][panel-shell]、[嚴格參數][host-api]、[現有 bridge](../../team-orchestrator-orca-plugin/src/worker-bridge.mjs)

`[推論／提案]` 產品可維持同一「建立團隊／選 agent／啟動／觀察／停止」流程；OS、shell、provider flags 放在 Orca 的執行邊界後。內部使用 **Orca CLI** 作宿主運輸不會使產品變成 Codex／Claude 插件，但自行拼接 `claude`／`codex` 命令會繞過部分宿主路由，需被明確識別為不同能力的相容策略，而非透明等價。

### Worker 有回收與重啟，不能當成永久 coordinator

`[源碼事實]` Worker 啟動為獨立 fork，環境採 allowlist，`execArgv` 清空；入口透過 `pathToFileURL` 與可攜 separator 處理 Windows 路徑。預設 ready timeout 10 秒、command timeout 30 秒、無 in-flight 工作的 idle reap 5 分鐘；shutdown 可呼叫 `deactivate`，父程序給 2 秒 grace 後終止。命令 timeout 並沒有對應的 `cancelCommand` 協定訊息，不等於執行中的外部動作已撤回。[runtime][worker-runtime]、[process][worker-process]、[protocol][worker-protocol]、[idle reap][worker-manager]

`[推論／提案]` 跨重啟的成員身份、operationId、已建立 handle、prompt 回執與未確定結果必須有 durable 記錄；長任務適合快速返回 job／operation 回執，再查詢或訂閱結果。現有 storage 是每 value 256 KiB、總量 5 MiB、最多 1024 keys 的 key-value store，沒有公開 CAS／transaction 方法，不能直接假設能容納無界歷史或多實例並發協調。[storage 限額與方法][host-api]

### Events 可以輔助觀察，不能替代身份與初始快照

`[源碼事實]` `agent.status.changed` 帶 nullable worktreeId、paneKey、state、receivedAt，以及可選 mainAgent；它表達主 agent 與子 agent 合併後的活動狀態，並非任務結果。恢復的未確認歷史 row 不會投影為新的活動事件。manifest 訂閱會 lazy-start worker；動態訂閱僅投遞給已運行 worker，且投遞失敗可記錄 dropped。[event schema][events]、[projection][status-projection]、[delivery][event-delivery]

`[推論／提案]` 需要在重新打開 panel、worker 重啟、Orca 重啟後建立 snapshot，再接 events；未收到事件、host 失聯或 list 未覆蓋該 host 都不能解讀成 agent 已退出。terminal handle 是 runtime-scoped，重啟後應重新取得；成員 ID 必須獨立於 tab 名稱與暫態 handle。[官方 handle／hostScope 說明][cli-reference]

## macOS 與 Windows：同一產品契約、不同執行證據

`[源碼事實]` Orca 官方提供 macOS／Windows 發行包；plugin worker 的 ESM 入口與環境程式碼明確處理 Windows 路徑、環境鍵大小寫及系統變數。官方設定文檔說 worker 在當前電腦運行，SSH workspace action 經 Orca 路由。agent 發現由 workspace 的執行宿主決定，可能是本機、WSL 或 SSH；桌面 `process.platform` 本身不足以決定 agent 的執行環境。[安裝文檔][install]、[worker runtime][worker-runtime]、[worker env][worker-env]、[設定文檔][settings]、[發現實作][agent-detection]

`[源碼事實]` Orca 的 launch intent 不要求呼叫者指定 structured／terminal；宿主依設定和當次可行性選擇，回傳 `outcome.kind`、handle、必要時 sessionId、prompt delivery 回執。新 CLI 會探測 runtime capability，且對 prompt carry、presentation、replay 支援不足回報不相容，不僅檢查版本號。因此 macOS／Windows 的 UI 可以一致，而底層應報告「此工作區上某 agent 的某項能力不可用」。模型及 effort 是 agent 的選項，不能因 UI 中立就承諾兩家相同選項全集。[intent／receipt][launch-intent]、[能力協商][launch-request]

| 驗證軸 | 現有證據 | 仍不能聲稱 |
| --- | --- | --- |
| macOS 本機安裝包＋原型 adapter | 前次只讀檢查復現 fuse 位置讀錯，尚未進入注入 | 不能聲稱修正後整條啟動／命名／消息鏈已成功 |
| Windows 安裝包＋原型 adapter | 原型有 Windows package、env、PowerShell 分支；官方 worker 有 Windows 支援程式碼 | 沒有 Windows 實機端到端證據，不能標為已支持驗收 |
| macOS／Windows＋Codex／Claude | Orca 官方預設 agent 與統一路由包含兩者 | 不保證任意安裝、登入狀態、provider 版本、模型／effort 都可用 |
| native／WSL／SSH／paired host | 官方分開探測與路由能力 | 不可把桌面平台等同執行平台，也不可假設 remote runtime 與 desktop 同版本 |
| structured／terminal | 官方 intent／receipt 分類清楚 | 不可把 terminal rename、讀屏、停止語義不經驗證地套到所有 native session |

以上是待驗收維度，不是本次替 Lin 決定首版必須涵蓋所有遠端拓撲；至少 macOS、Windows、Codex、Claude 是已給定的產品約束。團隊是否允許同時混用兩種 agent，仍是產品決策。

## 現有 runtime adapter 能力與失效邊界

`[源碼事實]` 現有鏈路是 panel envelope → 被注入包裝的私有 Electron IPC → 原本的 panel gate → 自身 `team.control` worker command → Orca CLI。它用 owner／token leases、目前 consent、command allowlist 與 nonce 做隔離；從私有 `session:get` 取 activeWorktreeId，並取得當前 desktop 的 userData／appData，避免 worker cwd 或錯誤 profile 把命令導向別處。[adapter](../../team-orchestrator-orca-plugin/src/local/adapter.mjs)、[CLI profile](../../team-orchestrator-orca-plugin/src/local/cli.mjs)

| 前提／邊界 | 已看到的行為與失效條件 |
| --- | --- |
| 包裝與 fuse | bootstrap 直接讀 `process.execPath` 的 sentinel。前次 macOS 實測：`Contents/MacOS/Orca` 找不到，Electron Framework 中卻有且 inspector 位為開啟，於注入前拒絕。這是該包裝路徑的故障，不是 Orca 只支持某平台的證據。[前次實測](../team-orchestrator-orca-analysis.md) |
| Debugger／PID | 需要 `process._debugProcess`、loopback 9229、唯一 Node inspector target 且 PID 等於 parent；port 被佔、Node 能力缺少、fuse 關閉或 parent 假設改變都可失敗；只有其自行開啟且取得 client 時才嘗試關閉 inspector。[bootstrap](../../team-orchestrator-orca-plugin/src/local/bootstrap.mjs) |
| 版本與私有 IPC | 檢查 app 名 Orca、版本符合 `1.4.x`、`ipcMain._invokeHandlers` 與若干固定 channel 名。正則版本檢查不是 upstream 相容性承諾；替換 handler 後的 host 升級、重載或 channel 重構都需重新驗證。[bootstrap](../../team-orchestrator-orca-plugin/src/local/bootstrap.mjs)、[adapter](../../team-orchestrator-orca-plugin/src/local/adapter.mjs) |
| Worker 啟動與重試 | panel 不自動激活；初始化命令或事件觸發。bootstrap 將失敗回成 `ready:false`，worker 快取該 Promise，`team.initialise` 才顯式重設；不能只重按 Test connection 假設重新初始化。[worker](../../team-orchestrator-orca-plugin/src/worker.mjs) |
| CLI 安裝與環境 | 原型從 worker entry 相鄰的 `../cli/index.js` 找同包 CLI，以 Electron Node 執行、`shell:false` 並還原本 desktop profile。這依賴包布局；scrubbed worker env 不自動帶齊 desktop 的 APPDATA／ORCA_USER_DATA_PATH。[CLI runner](../../team-orchestrator-orca-plugin/src/local/cli.mjs)、[官方 env][worker-env] |
| Workspace identity | 目前依私有 desktop session 選中項；worker 再用 `worktree show` 與 hash 比對。此保護有價值，但應由正式宿主提供可驗證 scope，不能改成從 displayName／branch／cwd 猜身份。[adapter](../../team-orchestrator-orca-plugin/src/local/adapter.mjs)、[executor](../../team-orchestrator-orca-plugin/src/local/executor.mjs) |
| Provider／shell 回退 | 找不到 `agent launch` 時拼接 `codex`／`claude` 命令，用 POSIX 或 PowerShell quoting；會失去部分 Orca 統一路由與使用者 launch 設定語義。根據 path／desktop platform 推論 shell 也不能當成所有 Windows、WSL、SSH 組合已驗證。[executor](../../team-orchestrator-orca-plugin/src/local/executor.mjs)、[startup command](../../team-orchestrator-orca-plugin/src/local/startup-command.mjs) |
| 結果與重播 | 原型有 request fingerprint、持久化 launch receipt、先存 handle 再命名；仍可能停在 starting／unknown，且 `agent-context` 有命令不代表選定 execution host 具備所需 runtime capability。正式 `agent launch` 本身另有 capability/replay 協商。[executor](../../team-orchestrator-orca-plugin/src/local/executor.mjs)、[官方協商][launch-request] |

`[前次實測]` 25 項原型單元測試及調整 macOS TMPDIR 後的 host fixture 通過，只能證明其覆蓋的邏輯；host fixture 固定另一 Orca commit 並模擬 IPC，原型 README 的 native 注入證據為 Linux fixture。這些都不能提升成 macOS／Windows 真實 agent 啟動驗收。[前次報告](../team-orchestrator-orca-analysis.md)、[原型範圍](../../team-orchestrator-orca-plugin/README.md)

## 可選整合路線與最小 upstream 缺口

以下全部是 `[推論／提案]`，名稱是能力描述，**不是目前可用的 SDK 方法名**。

| 路線 | 成立條件 | 優勢／成本 | 尚需 Lin 決定 |
| --- | --- | --- | --- |
| 官方插件門面＋Orca runtime 能力 | upstream 加入受控 panel→worker、可信 scope，以及插件所需的 agent／任務操作門面 | OS／provider 路由留在 Orca；同一 capability／consent／audit 邊界；需 upstream 配合與版本策略 | 發佈是否等待官方宿主能力到位 |
| 官方 bridge／scope＋worker 內 Orca CLI 運輸 | 先取得官方 panel 通道與身份；有可定位的受支持 CLI、正確 profile 與 execution-host capability negotiation | 可縮小第一輪 upstream 改動；CLI 是 Orca 自身介面，但命令呼叫未必以 plugin actor 審計，可信 Node 的權限邊界較寬 | 是否接受該權限／支援邊界作首版中間路線 |
| 現有注入 adapter 相容層 | 精確 host build／package allowlist、真實 Windows／macOS 驗證、debugger 可用、失敗不繞過 consent、可撤銷與遷移 | 可維持現有宿主上的實驗，但需持續承擔私有 API 與封裝耦合；修 Mac 路徑只是其中一項 | 是否對外發布相容層，或僅保留開發驗證用途 |

以目前原型為起點，**解除連線阻斷的最小宿主能力**有兩項；取得完整 Orca 原生團隊行為另需後續能力，不能混成「一次全部補齊才能開發」。

1. **受控 panel 呼叫自身 worker command**：host 綁定 plugin／panel／owner／session，僅允許 manifest 宣告 command；呼叫前重新檢查 consent、payload／rate limits，lazy-start worker，回傳可區分 not activated、denied、timeout、worker crashed 的結果。不要暴露任意 IPC／任意 runtime RPC。
2. **可信工作區與 execution-host scope**：由宿主對此次使用者操作取得 opaque reference，含足以判斷 stale／disconnected 的 revision 或有效期；適用 worktree 與 folder workspace、多 window 與不同 host。避免把內部含路徑的 ID 直接擴散到 HTML。需要同一安裝/profile 的 CLI transport 時，應有受支持定位方式或由 host broker 代辦，而非從私有包布局推導。

**支撐完整開發 spec 的下一層能力**可由擴充 plugin façade，或被選定的受支持 Orca transport 提供：

- **Agent 發現及啟動**：按 execution host 列出可用 agent／能力，以宿主意圖啟動；保留 operationId、outcome kind、prompt disposition、session／handle 與 provider 選項驗證，沿用 Orca 使用者設定。
- **狀態與恢復**：snapshot＋訂閱、可重綁身份及 host 覆蓋範圍；不要以工作狀態代替任務完成，以 plugin worker 存活代替團隊存活。
- **命名、取消與釋放**：對 structured／terminal 分別映射到正確宿主操作，區分取消一個 turn、停止 worker、釋放 UI、保留可恢復會話；以結果回執證明作用於正確成員。
- **儲存與權限**：明確團隊定義與 runtime receipt 的 scope、大小界限、版本遷移、並發寫入與 plugin disable 行為。使用 host facade 時保留 plugin actor；若採 trusted Node＋CLI，明示其較廣執行權限而不假裝受七個 capability 全面限制。

這些要求的依據是現有 facade 與 runtime 的落差；並不要求重新實作 Orca 已有的 provider adapters、Run／Task／Dispatch 或消息系統。[公開 API][host-api]、[native launch][launch-intent]、[官方編排][orchestration]

## 對後續決策與驗收的輸入

本研究可解除「宿主到底有什麼、缺什麼」的未知；仍應由地圖的決策票確定整合／版本政策、團隊模型、runtime 映射與發布範圍。待決問題包括：是否以 upstream 能力為正式發佈前提；相容層的生命週期；同團隊是否允許 Codex／Claude 混用；哪些遠端拓撲屬首版；取消與保留會話的產品語義。本文不替 Lin 作答。

後續實作驗收至少應覆蓋 macOS／Windows × Codex／Claude 的支持組合，並保存宿主版本、已探測能力與實際回執。冷啟動 panel、同意撤銷、worker 回收／重啟、切換 workspace、未知啟動結果重試、structured／terminal 命名與關閉都應各有可觀察結果。無 Windows 實機證據的項目繼續標記未驗證；本研究不新增功能或測試來冒充這些驗收。

## 來源索引

下列官方原始碼連結均固定在 `02356732b0a4b8fa46aefead303f6f092611c18d`，每個引用檔案都以 `git cat-file -e` 核對存在。前次本機觀察與原型程式碼由同一研究分支保存，方便後續重查，原分析保留原文而不把本研究的產品方向倒寫成過去事實。

[host-api]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-host-api.ts
[manifest]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-manifest.ts
[capabilities]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-capabilities.ts
[consent]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-consent-fingerprint.ts
[panel-controller]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-panel-controller.ts
[panel-shell]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-panel-shell.ts
[plugin-service]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-service.ts#L271-L281
[host-bindings]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-host-method-bindings.ts#L72-L111
[service-bindings]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-host-service-bindings.ts
[worker-runtime]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-host-runtime.ts
[worker-process]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-host-process.ts
[worker-protocol]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-host-protocol.ts
[worker-manager]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-worker-manager.ts#L229-L266
[worker-env]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-worker-env.ts
[events]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-events.ts
[event-delivery]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-event-delivery.ts
[status-projection]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-agent-status-event.ts
[preflight]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/preflight.ts#L24-L50
[agent-detection]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/preflight/workspace-agent-detection.ts
[launch-cli]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/cli/specs/agent-launch.ts
[launch-runtime]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/agent-launch.ts
[launch-intent]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/agent-launch-intent.ts
[launch-request]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/cli/agent-launch-request.ts#L91-L138
[sessions]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/structured-agent-session.ts#L85-L141
[rename]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/workspaces/workspace-removal-target.ts#L221-L251
[cli-reference]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/reference.mdx#L161-L195
[orchestration]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/orchestration.mdx
[settings]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/settings.mdx#L158-L163
[install]: https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/install.mdx
