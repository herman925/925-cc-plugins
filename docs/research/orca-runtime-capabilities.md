# Orca 原生 Team Orchestrator：agent runtime 能力研究

研究日期：2026-10-15。對應決策：[Orca spec：統一 agent 控制、消息與狀態的可用能力](https://github.com/herman925/925-cc-plugins/issues/97)。上層地圖：[Map: Orca 原生 Team Orchestrator 開發 spec](https://github.com/herman925/925-cc-plugins/issues/95)。本文件提供事實與設計約束，不代表 Lin 已確認首版範圍或實作方案。

## 結論

Orca 已有以宿主為中心的團隊執行基礎：Run、Task、Dispatch、受監督的 worker、持久消息、問答、生命週期回報及資源回收。Claude Code 和 Codex 都可以透過相同的 `worker-start --agent <id>` 入口被協調。因此產品應把團隊角色與任務語義建立在 Orca 上，讓宿主負責選擇 provider、工作區與執行方式。原版以 Claude session、Claude flags、Claude tools 為核心的控制不可直接成為新插件的共同契約。[官方編排說明](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/orchestration.mdx#L8-L47)、[原版啟動命令](https://github.com/herman925/925-cc-plugins/blob/b36f3be2f664675ee2f79404e00ae57e9ad27d81/team-orchestrator/hooks/register.tsx#L752-L762)

**關鍵缺口是可受支持的插件存取契約。**目前公開 plugin API 沒有 agent launch、Run、Task、Dispatch、mailbox 或恢復操作；panel 只有 `workspace.readContext`、`terminal.sendText`、`notifications.show`，worker 額外取得私有存儲、設定、秘密及事件訂閱等。宿主內部有能力，不等於第三方 panel 或 worker 已有同等 API。該 API 明確把內部 runtime RPC 排除於公開 facade 之外。[公開插件契約](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-host-api.ts#L5-L17)、[完整方法表](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-host-api.ts#L122-L265)

## 證據邊界與版本

| 證據 | 固定版本 | 能證明什麼 |
| --- | --- | --- |
| 使用者已安裝 Orca 的對照基線 | `9fdd90ffa7721e145f1353ad9fb9df2f70c31f43`，2026-10-06；主分析識別為 1.4.222 | 本研究以 Git 物件檢查特定檔案，不重新驗證安裝包或啟動該版本 |
| 官方 Orca main 快照 | `02356732b0a4b8fa46aefead303f6f092611c18d`，2026-10-15 | 本文原始碼引用預設以此 SHA 為準；不能推定已隨使用者安裝版發布 |
| Herman 原版 | `b36f3be2f664675ee2f79404e00ae57e9ad27d81` | Claude mod 的現有耦合及權限語義 |
| 官方網頁 | GitHub 搜尋與固定 SHA 的 raw 檔案 | 核對官方來源；不採用搜尋摘要代替原始碼判斷 |

兩個 Orca SHA 的 `plugin-host-api.ts`、`plugin-capabilities.ts`、`plugin-manifest.ts` 與編排文件經對照，關於上述公開 API 缺口與基礎編排的結論一致。其他 main 實作只證明該快照具備相應邏輯；spec 必須另外定義最低宿主版本及能力協商。本文沒有啟動真實 worker、執行產品測試、修改已裝 Orca、修改 provider 設定，亦沒有 Windows 實機驗證。原始碼中的測試案例不等於本次已通過平台測試。

## 必須分開的三層

| 層次 | 現有能力 | 新插件可如何使用 |
| --- | --- | --- |
| 公開 plugin host API | 讀取聚焦工作區的顯示資訊與 terminal IDs、向明確 terminal 輸入文字、通知；worker 私有資料與事件 | 可依已授權 capability 呼叫；`terminal.sendText` 回 `accepted`，沒有 worker 啟動、回合開始或任務完成保證 |
| Orca CLI 與宿主 runtime | Run／Task／Dispatch、`worker-start/show/read/stop/release`、消息、問答、模型選擇、內部 `agent.launch` | 是可重用的宿主實作與契約研究來源；尚未成為第三方 plugin facade |
| Provider 整合 | Claude、Codex 各自的啟動、認證、hooks、transcript、structured session、上下文回報 | 由 Orca adapter 處理差異；插件只承諾能力探測後可達成的語義 |

公開 workspace 回覆沒有穩定 workspace ID、執行主機 ID、provider session 或 Run 身份；不能用顯示名稱、目前焦點或 branch 名稱替代任務歸屬。worker 事件確實帶 `worktreeId` 和 `paneKey`，但這不等於有可列舉、重建、查詢的完整 session API。[workspace 與 send schema](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-host-api.ts#L25-L52)、[事件 payload](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-events.ts#L11-L54)

可信 Node worker 技術上能使用自身 Node 權限；官方 audit 說明也承認這類動作不經 host API 的審計。這說明「公開 API 缺失」不是「Node 絕對不能執行 Orca CLI」。但自行啟動 CLI 不會自動取得穩定的插件 caller identity、Run authority、workspace context 或公開相容保證；worker 的環境亦為 allowlist，不繼承完整宿主環境。是否採取這類過渡層，屬另一個待決架構問題，不能在本研究偷渡成正式方案。[審計邊界](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-audit-log.ts#L4-L11)、[worker 環境](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/plugins/plugin-worker-env.ts#L1-L51)

## 可重用 primitive 與限制

下表的「宿主已有」均指 Orca runtime／CLI；除明確寫出 plugin API 的項目外，**均未公開給第三方插件**。

| 需求 | 宿主已有 primitive | 對 spec 的約束 |
| --- | --- | --- |
| 一次團隊運行 | Run，durable namespace 與 coordinator inbox | Run 自身不排程、不放置 worker；團隊名冊與組織層級仍是插件領域 |
| 任務及依賴 | Task：spec、dependencies、parent、狀態；decision gate | 不把組織上下級和任務 DAG 當同一種關係 |
| 執行一次任務 | Dispatch，附到 worker 身份並提供 lifecycle authority | 同一 Task 重試是新 attempt；不能只憑 Task ID 接受完成回報 |
| 啟動並派工 | `worker-start` 組合 placement、setup、readiness、preamble、資源所有權 | 避免另做「開 terminal＋拼 provider 命令＋猜 ready」流程 |
| provider／模型 | `--agent`、`--model`、`--effort` 與 requested/effective receipt | agent 必須在執行宿主啟用；模型名稱為 provider opaque ID；effort 須該模型支持；重用 terminal 不可同時套用模型覆寫 |
| 消息與廣播 | 持久 mailbox、Delivery、`check`、`send`、`reply`；Run 範圍群組 | `@all` 指 sender 所屬 Run 的 live Dispatch；不代表全部組織名冊 |
| 阻塞問答 | worker `ask`、coordinator `reply`，持久 question／thread ID | timeout 或斷線不等於問題不存在；以原 message ID resume |
| 工作狀態 | `worker-show/list`、宿主 agent status、heartbeat；插件有受限 status event | state、liveness、任務 outcome、資源狀態要分開；不能把 `done` 圓點直接當 Task 完成 |
| 停止、收尾 | `worker-stop`、`worker-release`、`worker-retain`、`worker-read` | 停止要有確切身份與宿主結果；release 只回收擁有的資源，保留可讀檔案 |
| 重啟、重綁 | Run `run-use`、durable task/dispatch、host identity reconciliation | 重綁 Run 不等於恢復 provider 對話；未知結果先查證，不能立即重複 launch |

上述概念、命令及群組規則見[官方編排文件](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/orchestration.mdx)。啟動實際組合流程見 [local-worker-start](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts#L148-L309)；模型覆寫與遠端能力檢查見 [worker-launch-preferences](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/worker-launch-preferences.ts#L13-L94)。

### 消息、問答與完成的精確含義

`check` 的 delivery 在 ack 前會重播，故 UI 更新或外部動作需要去重。問答必須來自 active supervised Dispatch，回覆必須具備該 Run 目前 consumer 的權限。`ask --resume <messageId>` 延續同一問題；中斷等待不會創建第二個問題。不要把「問題等待超時」視為可以替使用者選答案。[ask 實作](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/messaging/ask-methods.ts#L66-L193)、[reply 身份檢查](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/messaging/message-methods.ts#L73-L115)

worker 收到的 preamble 教它發 `worker_done`、heartbeat、ask，以及在自然檢查點讀取 follow-up。這是一套由 agent 配合的行為協定，不能推論成 provider 在任何時點都被強制中斷或保證立即接收轉向指令。worker 完成後可以留在 idle，之後用新的 Dispatch 重新派工；跟進消息的持久入列不等於 agent 已讀。等待 CLI 每 15 秒寫到 stderr 的保活訊息，亦不可混同某個 worker 的工作進度或 `worker_done`。[preamble 行為協定](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/preamble.ts#L96-L145)、[重新派工規則](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/preamble.ts#L182-L230)、[等待 CLI 說明](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/orchestration.mdx#L129-L150)

完成是宿主接受的 `worker_done` outcome，並驗證 task／dispatch 對應與當前生命週期；重複同結果有 duplicate 語義。代理回合停止、畫面沒有新文字、terminal 被關閉都不能取代這項事實。[完成交易](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/db/dispatch-context/worker-report-settlement.ts#L69-L139)

### 啟動成功有不同證據強度

官方 worker-start 先等待可接受輸入，再送 preamble，最後觀測回合開始；送文字成功本身不是工作已開始。[啟動流程](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/local-worker-start.ts#L221-L292)

| `turnStart` | 原始碼的含義 | UI 可誠實呈現的內容 |
| --- | --- | --- |
| `observed` | provider 有回合開始的正向證據 | 已開始處理 |
| `permission` | 輸入後出現批准提示 | 正在等待人工處理 |
| `unsupported` | 該 provider／舊宿主沒有可用觀測訊號 | 輸入已交付，無法確認開始 |
| `unobserved` | 支持觀測，但時限內沒有證據 | 啟動結果待確認；不能當作死亡 |

宿主可能對 `unsupported` 返回 `ready`；插件若只顯示綠色 ready，仍會誤導。`unobserved` 會保留 lifecycle authority 與 terminal，記為 `outcome_unknown`／內部 `start_unknown`，之後合法 worker 回報仍能結算。此處建議的 UI 文案是研究推論，待狀態設計 ticket 確認。[turn-start verdict 定義](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/worker-start-turn-observation.ts#L5-L37)、[readiness 結算](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/worker-start-readiness-settlement.ts#L74-L161)

## 身份、恢復與資源所有權

| 名稱 | 代表什麼 | 不可拿它代替什麼 |
| --- | --- | --- |
| 插件 `memberId`（待定義） | 團隊名冊中的持久成員身份，可保留名稱、角色、報告關係 | 不能直接等同 terminal 或 provider session；換模型、重啟、重新派工未必換成員 |
| terminal handle／pane key | Orca 所管理的執行位置與路由 | 不單獨證明目前仍是同一 process，也不賦予 Task 完成權限 |
| process incarnation／launch token／host scope | 宿主確認的特定執行實例與環境 | 不能用名字相同的 terminal 取代 |
| Orca session ID | structured session 的宿主身份；目前 party 可有 handle，也可只有此 ID | 不等於 Claude session ID 或 Codex thread ID |
| provider session | provider 對話或 transcript 的定位資訊 | 不可推定跨 provider 可續接同一對話 |
| Run／Task／Dispatch IDs | 協調空間、工作項、一次執行嘗試及權限邊界 | 同一成員會有多個 Dispatch；不能讓舊 attempt 完成新 attempt |

前一列是建議的插件領域模型；其他列來自 [Orca party identity](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/orchestration-party-identity.ts#L3-L18)、[worker authority 綁定](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/db/worker-dispatch/worker-dispatch-authority.ts#L5-L85) 及 [provider session 精確匹配](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/worker-provider-session.ts#L8-L70)。

Run 可以明確 `run-use` 重綁，目前 consumer 的等待會被取消／隔離；沒有 pane 或 Orca session 身份的 caller 不能直接綁定 Run。這是原生插件需要宿主支持 coordinator actor 的具體理由：不能讓 worker 虛構 `--from` 或借用任意可見 terminal 當自己。[Run 綁定](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/runs/runs.ts#L56-L113)、[caller identity 前提](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/orchestration-caller-identity.ts#L16-L39)

恢復時要先詢問宿主：`live`、`unverifiable`、`exited` 是不同證據結果。缺少 status、過期 status 或重啟後未確認的資料都屬 `unverifiable`；不能據此自動重啟第二個 editor。`worker-stop` 確認所指進程與資源所有權，沒有證明成功可回 unknown；`worker-release` 也不是任意 terminal close 的別名。此模型應保留到插件 spec。[liveness 投影](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/orchestration-fleet-worker-projection.ts#L45-L95)、[停止與所有權檢查](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/rpc/methods/orchestration/worker/worker-stop.ts#L144-L245)

跨 provider handoff 是新會話加有界上下文摘要；官方也特別指出這不是 `codex resume`。新插件可以保持同一邏輯成員，但不能聲稱原生對話記憶完整轉移。[官方 handoff 說明](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/agents/codex.mdx#L25-L35)

## 跨 macOS／Windows 與跨 provider 的保證邊界

同一插件可定義相同的團隊與任務語義，但底層可用能力仍由執行宿主、provider、安裝版本、登入狀態及設定共同決定。把平台差異交給 Orca，不表示忽略差異或取消平台驗收。Orca 本身要求所有跨平台細節由對應 runtime 處理，包括 Windows process、shell、WSL 與檔案路徑。[官方跨平台開發約束](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/AGENTS.md#L76-L105)

| 能力 | 可以支持的共同語義 | 需要揭示的差異／限制 |
| --- | --- | --- |
| Claude／Codex 啟動與派工 | 宿主 `--agent` 選擇，使用同一 Task／Dispatch 協定 | 各自仍需安裝、登入及宿主啟用；不能因產品是 ADE 插件便承諾無需 provider runtime |
| terminal／structured chat | 使用宿主決定的執行模式，消費 receipt 的 mode／reason | Chat 偏好不是強制；不可假定 worker 永遠有 PTY，也不可把 Windows 固定成某模式 |
| Windows native／WSL | 官方 Codex 文件包含兩種宿主路徑 | WSL、遠端與 native local 是不同 execution location；支援要由宿主判定 |
| agent status | Orca 正規化狀態，插件 worker 可訂閱受限事件 | hooks 可被使用者關閉；事件是投影，沒有完整 provider identity／context usage／Task outcome |
| 模型與 reasoning effort | 按 provider 提交選擇並顯示 requested/effective | 不把 Claude 模型名或 effort levels 當全域 enum；不要靜默忽略不支持的設定 |
| 上下文使用量 | 宿主 structured adapters 已有 report／estimate／unknown 模型 | Claude 與 Codex 資料來源不同；目前 plugin API 未公開，缺值不能畫成 0% |

Claude 與 Codex 的 native structured location predicate 在 main 都使用 `isNativeLocalLocation`；基線版本也允許 local 且非 WSL。單憑 launch-mode 檔留下的 `codex_on_windows` 字串，不能判定 Codex 在 Windows 一律不能 structured。仍須以執行宿主的 create-support 判定為準，再驗證真實組合。[Codex location](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/codex/codex-structured-location-support.ts)、[Claude location](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/claude/claude-structured-location-support.ts)、[宿主支持探測](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/structured-agent-launch-support.ts#L83-L107)、[模式決策](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/agent-launch/agent-launch-mode.ts#L126-L205)

Windows native／WSL 啟動的官方描述見 [Codex on Windows](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/agents/codex.mdx#L41-L43)。hooks 的開關與跨重啟 endpoint 由 Orca 處理，插件不應自行修改 `.claude`／`.codex` 全域設定重建同一機制。[hooks 與 memory](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/agents/hooks-memory.mdx#L9-L27)

上下文使用量在 structured session 已有共同資料型別，但含 `unknown` 且區分 provider report 和 estimate；Codex adapter 讀取 `thread/tokenUsage/updated` 的最近一次用量，並非累積花費。這支持將 context 顯示視為可選觀測能力，而不是核心啟動判準。[context 契約](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/agent-session-context-usage.ts#L32-L65)、[Codex context adapter](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/codex/codex-context-usage.ts#L16-L44)

## 角色、寫入與 subagent 政策不能混為一談

Herman 原版用 `--append-system-prompt` 指向角色文件，並針對 Claude 工具 `Agent`、`Write`、`Edit` 等實施角色 guard。這些 tool 名稱和攔截位置屬 Claude mod，不是通用 Orca plugin 能力。原版對採納的其他 CLI 還明確標為不管理，不替其重開、關閉、brief 或傳訊。[原版角色啟動](https://github.com/herman925/925-cc-plugins/blob/b36f3be2f664675ee2f79404e00ae57e9ad27d81/team-orchestrator/hooks/register.tsx#L752-L762)、[原版工具 guard](https://github.com/herman925/925-cc-plugins/blob/b36f3be2f664675ee2f79404e00ae57e9ad27d81/team-orchestrator/hooks/guard.ts#L64-L103)、[其他 CLI 邊界](https://github.com/herman925/925-cc-plugins/blob/b36f3be2f664675ee2f79404e00ae57e9ad27d81/team-orchestrator/hooks/register.tsx#L2773-L2805)

| 政策 | 現有共同基礎 | 尚不能保證 |
| --- | --- | --- |
| 角色／報告對象 | 可把 role、任務、上下文放入宿主 preamble／task spec | 每回合一定重讀角色文件、所有 provider 以 system prompt 優先級執行 |
| 誰可派工／完成／回覆 | Orca Run、Dispatch、consumer fencing；nested Dispatch depth 限制 | 不能等同阻止 provider 自己的內建 subagent 或任意 shell 啟動其他進程 |
| manager 不寫碼 | 可用角色指令表達；provider 可能有其自身 approval／sandbox 能力 | 公開插件 API 沒有跨 Claude／Codex 的逐工具強制攔截；不能把指令稱為硬權限 |
| 文件隔離 | worktree 分開 checkout、宿主管理生命週期 | worktree 不構成安全 sandbox；正式文件明確說明進程仍可使用自身檔案／網路權限 |

Orca 的 nested depth guard 確實在所有建立 live worker 的 Dispatch 路徑檢查上限；它管的是 **Orca Dispatch**。公開 plugin capability enum 只控制插件 API 呼叫，沒有通用 provider tool deny／read-only manager 能力。若後續 spec 要強制這類政策，必須開宿主與 provider adapter 能力議題；否則 UI 應明示 advisory／unsupported，不提供看似已強制的開關。[Dispatch depth guard](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/main/runtime/orchestration/db/dispatch-depth.ts#L198-L217)、[插件 capability 範圍](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/src/shared/plugins/plugin-capabilities.ts#L3-L43)、[官方權限及 worktree 邊界](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/agents/supported.mdx#L7-L23)

## 對開發 spec 的輸入

以下是由證據推導的候選要求，供後續決策 ticket 使用，**尚不是已核准 API 或最終設計**：

1. 插件擁有 Team／Member／Role／報告關係與 preset；Orca 擁有執行、認證、provider、Task／Dispatch 事實和資源生命週期。保留明確綁定，不建立第二套臆測的 runtime 真相。
2. 請求正式宿主 facade 時，以「受授權的插件 actor＋明確 workspace／host scope＋版本化結果」為單位，至少涵蓋 capability discovery、Run 綁定、Task／Dispatch 操作、消息／問答、狀態快照與訂閱、停止／重試／回收。panel-to-worker 通道、插件 actor 與編排 facade 是不同缺口，只補通道不會自動補足身份與權限。
3. 任何 launch／send／stop 需回傳 operation identity、效果與 unknown／unsupported 原因。任務 UI 同時保留 launch／turn-start 證據、liveness、任務 outcome、資源所有權；不能只存單一 `running` 布林值。
4. Claude／Codex、macOS／Windows 都列為產品支持目標；由宿主 capability 決定可用 provider／mode。統一插件包不應包含自行探測 Electron fuse 或注入私有 IPC 作為正式核心運行契約。
5. 啟動前呈現缺少的宿主能力或設定。編排目前是 Experimental，需要開啟；退休的 `orchestration run`／`run-stop` 不產生效果，不得誤用成整隊啟動或停止。[官方前提與退休命令](https://github.com/stablyai/orca/blob/02356732b0a4b8fa46aefead303f6f092611c18d/docs/site/content/docs/cli/orchestration.mdx#L12-L21)

最低驗收矩陣應包含 macOS 與 Windows native 各跑 Claude、Codex 的相同任務：啟動、明確開始或誠實 unknown、問答／resume、回報、停止、回收、宿主重啟後重新定位；再測缺少登入、hooks 關閉、舊宿主、不支持的 effort、使用者接管 terminal、重複回報與遲到回報。Windows WSL、遠端、structured／terminal 組合是否列首版硬要求，應明確決定並逐格留證；此研究沒有宣稱任何一格實測通過。

仍需 Lin／後續決策確認：首版是否要求同一團隊混用 Claude 與 Codex；是否等待正式 upstream plugin orchestration 契約或接受有退出條件的過渡層；角色限制採 advisory 還是要求 provider 可強制；coordinator 由插件 actor、人工或特定 agent 擔任；成員與執行會話的持久綁定、未知狀態處理和恢復政策。這些問題的答案不由研究 agent 代替產品決策。
