# Orca Team Orchestrator：模型目录与剩余 issue 交接

交接日期：2026-10-18。下一会话优先解决 **#137 模型目录**，再按环境、证据和依赖推进剩余 issue。本次只归档交接，不实施 #137、不启动真实团队、不改变宿主设置或关闭 issue。

## 1. 先读这些，不重新设计两个页面

1. [AGENTS.md](../../AGENTS.md)、[插件 README](../../README.md)。
2. [ADR-001：Roster 与 New team 最终设计](../ADR-001-roster-new-team.md)。用户明确表示这两个 tab 的设计到此为止；后续修复沿用其职责和交互。
3. [#137：透过项目已开会话动态取得模型目录](https://github.com/herman925/925-cc-plugins/issues/137)的最新正文；这张票记录 ADR-001 后新增的模型目录方向，**尚未实现**。
4. [父票 #106](https://github.com/herman925/925-cc-plugins/issues/106)、[交付票 #129](https://github.com/herman925/925-cc-plugins/issues/129)及实际准备处理的子票最新正文、评论、标签和原生 blocking links。
5. 需要实机验收时查阅 [#125 报告](../validation/macos-local-125.md)、[脱敏回执](../validation/macos-local-125.receipts.json)、[#120–124 报告](../validation/ready-agent-120-124.md)和[终端命名记录](../validation/member-terminal-names.md)。它们记录的是当时版本的真实证据，不等于最新界面全部已实机通过。

[2026-10-16 交接](2026-10-16-post-136-next-session.md)是历史背景。它提到的旧页面入口、双启动模式、面板总目标验收、每个目标新对话、确切 build 限制及当时安装状态，不可作为当前行为要求。原生权限、身份、数据保全和未知结果不重复执行的约束继续有效。也不因旧文出现“指定子 agent”就自动发起多人协作。

## 2. 代码、远端与已有验证

编写本交接前核对：

| 项目 | 状态 |
| --- | --- |
| 仓库 | `herman925/925-cc-plugins`，插件位于 `team-orchestrator-orca-plugin/` |
| 分支 | `main` |
| 本地与 GitHub main | 均为 `a2cb8735304cb2277bf37db694b1ee7f7fac37b6` |
| 插件版本 | `0.1.17` |
| 最终功能提交 | `26bc866`：由 Lead 数量推导层级 |
| ADR 提交 | `a2cb873`：最终决策、文档索引与旧规格替代说明 |
| 本轮前 10 个提交 | 已按用户要求推送；不要再次把它们列为“尚未同步” |
| 开放 PR | 核对时无开放 PR |

0.1.17 已通过 **561 项核心测试、26 项浏览器测试、3 个 Orca 固定源码版本的 host contract 检查**，New team 在 320px 宽度下检查通过。这些不是 #137 的测试，也不是新的真实 provider 协作验收。不要仅为交接重跑全部检查；有修改后验证受影响路径。

本轮最后实机连接基线为 macOS arm64、Orca 1.4.229、Electron 43.7.8、Node 24.21.0。插件 0.1.17 的连接、nonce 和已有团队读取成功；本轮界面精简没有新建真实团队完成业务任务。下一会话重新发现实际 runtime，不沿用旧 PID、handle、session token 或连接状态。

交接文件和文档索引是本次文档变更；是否已提交以届时 `git status` 为准，上表是写交接前的代码基线。

## 3. 已定稿的产品行为

- **Roster 只读监控全员。** 当前项目的已启动团队包括 Idle、Not started、Unknown 等成员，不只显示 Working。保留 Add team 和每队一个 Open supervisor；没有个人详情、角色／模型修改、Stop／Wake／替换等管理表单。
- **New team 只配置人数和模型。** Leads = 1 生成 Head → Workers；Leads > 1 自动生成一个 Head → 多个 Leads → 各自 Workers。Workers per lead 独立设置，默认 Leads = 1、Workers per lead = 3。没有 Structure／Levels、预设列表、Head only 或独立 CEO 创建流程。
- **项目自动识别。** New team 跟随当前项目并保留草稿，Launch 时重新读取并保存 scope。保存后的启动／工作不被后来焦点重定向。没有手动 Confirm project。
- **新队固定 All at start。** 先保存名册和稳定身份，再按宿主准入限流准备全部成员；不是所有会话瞬间同时就绪。旧按需配置继续兼容，不能据此恢复模式选择器。
- **日常工作只对接最高主管。** 业务交办、提问、增员决定和结果确认在主管会话中；正常后续交办使用有效会话与协调 Run。没有 Attention、Start team work、Submit total objective、Next total objective、总目标队列或面板验收。
- **没有 Templates／复制／导入导出。** 这些不是交付缺件，不为通过旧票重新实现。
- **CLI 提问按实际会话决定。** Codex 优先 `request_user_input`，Claude Code 使用 `AskUserQuestion`；只在可用且允许时调用，否则同会话直接提问等待明确回复。不改模式强开工具，空结果／取消／超时／沉默不算批准。协议认证主管记录答复，不是独立认证的用户工具回执。
- **显示不能冒充事实。** 未观测 Context 显示 `—`；未确认模型／effort 标记 `set`。普通终端标题可自动设为 `team/member`，原生 Chat 标题重命名尚未支持。

原版普通 Lead 没有按名字自动分配专业方向：编号用于识别，自由文本 `role` 和 Head 的任务指令确定职责。当前不增加专业岗位编辑表单。原版默认按需启动的调查已归档；资源开销动机是记录支持的推断，用户没有要求改回按需启动。

## 4. 第一优先：#137 的需求与尚未解决的问题

### 用户已明确的方向

准备 Launch team 时，**当前项目内必须已有至少一个 Codex 或 Claude Code session**，通过这个已开会话作为入口／上下文，动态联网取得、补齐模型目录。任一 CLI 即可开始，不要求同时打开两个 CLI，不让用户手填模型名，不使用随插件版本更新的静态型号表。

目录需要随项目、主机、会话、账户／后端及相关配置变化而刷新。可以有带来源、时间和 scope 的缓存；网页公开型号或模型凭记忆输出的列表不能直接证明当前账户能够启动这些模型。不同 CLI 的目录仍分别核实。

**这条“已有 session”前置尚未在 0.1.17 中实施。** 当前只是已接入 `agentSession.modelCatalog` 下拉框，缺目录时提供 Default。本轮在本机无 structured host 的情况下，session-less 目录请求返回 `hostDisabled`，所以当时仍只有 Default。

### 已查到的源码线索，不是已证明的解决方案

- [插件能力读取](../../src/local/capabilities.mjs)目前按 agent 和 worktree 请求目录，没有传入 sessionId。
- Orca 1.4.229 的[原生目录入口](https://github.com/stablyai/orca/blob/37c314bcc96063c42c468e564df2c34bac8ef8a1/src/main/runtime/rpc/methods/structured-agent-session-options-read.ts)：无 session 路径要求既有 structured host；带真实 structured sessionId 的路径会取得／安装 host，并读取该会话记录。
- [原生目录服务](https://github.com/stablyai/orca/blob/37c314bcc96063c42c468e564df2c34bac8ef8a1/src/main/native-chat/agent-model-catalog/agent-model-catalog-service.ts)支持 provider probe 和 `live-session` listing，按实际账户、会话及项目配置确定结果。
- 这不能证明“任意普通终端打开后，目录接口就一定可用”。**terminal handle、provider 对话 ID、Orca structured sessionId 不是同一种身份，不能互换或伪造。**

### 推荐首轮步骤

1. 重新读取 #137 和当前宿主版本／契约，确定当前项目内已有会话的真实身份、CLI、主机和形态。
2. 分别验证普通终端、原生 Chat；比较仅 Codex 已开、仅 Claude Code 已开的情况。形成小型能力／证据表，先定位 `hostDisabled`，不急于改下拉框。
3. 在有效会话和实际登录／后端配置上下文中，验证宿主读接口、provider/CLI 原生列举或其他受支持的动态联网路径。官方网页可以补充候选与说明；最终可选 ID／effort 要有当前目标的可用性依据。
4. 选择有证据的机制，再实现 session 准备检查、自动刷新、缓存失效和错误状态。缺有效会话时在现有 New team 提示先打开一个；不新建隐藏成员或临时 Chat 来凑前置，不暗改原生 Chat 设置。
5. 已开会话忙碌时遵守原生读取／排队能力，不打断其现有工作，也不把用户的“已有一个会话”偷偷改成“必须再开一个空闲会话”。不能把控制命令盲目打入一个按标题找到的终端。
6. 验证无 session、关闭／失效、错项目／host、忙碌、目录不可用和配置变化。SSH 数据必须来自远端目标；没有实际能力时保持未知，不用本机列表补假数据。
7. 按变更完成测试／构建与必要实机证明，更新 ADR／说明及受影响验收票。只有记录方案或 fixture 通过不能关闭 #137。

#137 目前只有 Lin 标签，没有 ready-for-agent；用户已明确指定下一会话优先解决它，不应仅因标签而反复询问是否可以调查或修改相关代码。具体获取机制仍待验证，不能将产品方向写成已实现能力。

## 5. GitHub 已经更新了什么

本轮已更新并回读核对 **#106、#125–131** 的正文：以固定提交的 ADR-001 替代冲突旧要求，撤去模板交换、双模式入口、面板总目标验收、每目标新对话及个人管理表单等交付条件。

当时的历史评论均保留；状态、标签、assignee、milestone 和原生 blocked-by 关系未改动。#125 原来勾选但缺证据的焦点切换被明确列为待补；已通过的旧版本证据单独归档，未改写成 0.1.17 已实机通过。

#137 已创建为 #106 的原生 sub-issue，也已加入 #129 的未完成验收条目。**没有增加 #137 → #129 的原生 blocking link**；不要误报为原生依赖已建立，也不能因没有这条 link 就忽略 #129 清单对 #137 的要求。

## 6. 剩余 issue 的实际顺序

以下为本次重新读取的状态快照，接手时仍需读最新正文／评论及依赖：

| Issue | 状态／依赖 | 下一步 |
| --- | --- | --- |
| [#137 模型目录](https://github.com/herman925/925-cc-plugins/issues/137) | OPEN / Lin；#106 子票 | 用户指定第一优先；按第 4 节先查证再实现 |
| [#125 macOS／本机](https://github.com/herman925/925-cc-plugins/issues/125) | OPEN / ready-for-human；原生前置 #116、#118、#119 均关闭 | 补焦点切换实证及当前主管会话流程的最小受影响回归，核对证据后收口 |
| [#126 Windows／本机](https://github.com/herman925/925-cc-plugins/issues/126) | OPEN / ready-for-human；同上前置均关闭 | 需要真实 Windows 环境，先验证宿主契约并完成适配，再跑四人混合流程 |
| [#127 macOS／SSH](https://github.com/herman925/925-cc-plugins/issues/127) | OPEN / ready-for-human；同上前置均关闭 | 有用户可用 SSH 环境后验证远端工作、断线恢复和 scope；不能外推本机结果 |
| [#128 Windows／SSH](https://github.com/herman925/925-cc-plugins/issues/128) | OPEN / ready-for-human；同上前置均关闭 | 需要 Windows＋SSH 组合的真实适配和验收 |
| [#129 两人自用交付](https://github.com/herman925/925-cc-plugins/issues/129) | OPEN / ready-for-human；原生依赖 #120–128，当前开放阻塞是 #125–128；清单另追踪 #137 | 两人安装／更新、四人工作闭环、真实支持矩阵与更新恢复指引；不恢复已删功能 |
| [#130 11 人](https://github.com/herman925/925-cc-plugins/issues/130) | OPEN / ready-for-human；被 #129 阻塞 | Leads = 2、Workers per lead = 4，1 Head＋2 Leads＋8 Workers，真实规模测试 |
| [#131 21 人](https://github.com/herman925/925-cc-plugins/issues/131) | OPEN / ready-for-human；被 #130 阻塞 | Leads = 4、Workers per lead = 4，1 Head＋4 Leads＋16 Workers，真实规模测试 |
| [#106 总票](https://github.com/herman925/925-cc-plugins/issues/106) | OPEN / Lin | 所有范围内子票满足真实完成条件后收口；不因仅代码或页面完成就关闭 |

#107–124 均已关闭。它们的历史交付不等于当前 UI 必须保留对应入口，也不等于本次产品精简使所有底层实现失效。仓库另有原版 mod、Session Panel、Hermes 和跨设备消息等开放事项，不自动扩入当前插件任务。

**Windows 目前仍被 [runtime-contract.mjs](../../src/local/runtime-contract.mjs) 主动拒绝。** 现行验证平台为 macOS arm64；兼容升级已改为检查能力／handler／证据格式，不代表 Windows 已支持。不能只删除 gate，或将 ready-for-human 当作“已适配、只差点击”。

## 7. #125 最小收尾与现存旧团队

最新关键依据为 [2026-10-16 核对评论](https://github.com/herman925/925-cc-plugins/issues/125#issuecomment-6214959287)，已反映到本轮更新后的正文：

- Git／folder 四人混合闭环、当时两种准备模式、并行与冲突、失败升级、Pause／Wake、插件停用恢复、整机重启、45 秒物理睡眠和执行中 Stop 等已有真实证据；不能要求全套重跑。
- 明确缺口是：团队保存并绑定项目 A 后，切换桌面到 B，核对受控操作的 TeamWork、Run、Task／Dispatch、会话和 host 始终属于 A，且不误投、不重复启动。
- 与此区别，**New team 在 Launch 前**应跟随当前项目；不能为了验证旧团队固定 scope，又加回手动确认。
- 本轮会话内交办／提问／后续工作及全部启动等改动，需要最小受影响的真实回归。旧版本已验收不等于这些新交互已经实机验证。
- 原先“必须保持 #125 开放直到用户另行决定”的旧限制已在 2026-10-16 晚间被替代。仍按真实证据决定是否可关闭；本轮因尚缺证据没有关闭它。

本机曾保存 `QA125-Focus` 的四人旧按需团队，team ID 为 `4e612b77-a0f8-4343-841a-5e114d6628c5`。2026-10-16 用户安排暂停时，其准备 Head 已通过原生 CLI 精确关闭；当时没有 TeamWork。2026-10-18 的 Roster 显示 Head Unknown、Worker Not started，旧 handle 可能报 `terminal_handle_stale`。

这些是历史现场信息，不是现在可用的运行身份。新会话先只读核对，不能沿用旧 live 假设、按名字重绑定、修改数据库清 reservation，或再次 Launch 绕过未知记录。当前 Roster 也没有 Wake／Reconnect 管理按钮。若需处理旧现场，使用现有有证据的恢复能力并说明实际限制，不为了测试恢复旧 UI。

单独撤权 UI、其他 provider 故障变体、SSH／structured／在途 Task 跨 runtime 重认证等未测边界仍须诚实记录；不是所有未测变体都自动成为新的全矩阵必测项。两个 Stop 测量 Work 不能作为已接受的总交付。

## 8. 主要代码入口与验证命令

| 文件 | 关注点 |
| --- | --- |
| [src/panel.mjs](../../src/panel.mjs) | New team、当前项目、目录刷新、角色模型偏好、Launch |
| [src/local/capabilities.mjs](../../src/local/capabilities.mjs) | 宿主发现、agent／账户相关能力、模型目录返回值 |
| [src/capabilities.mjs](../../src/capabilities.mjs) | 模型／effort 和新鲜度验证，Default 退路 |
| [src/local/adapter.mjs](../../src/local/adapter.mjs) | 真实主 frame、panel ownership、原生 consent 与 broker |
| [src/local/native-broker.mjs](../../src/local/native-broker.mjs) | 能力读取、启动准入、原生效果、命名与持久化结算 |
| [src/local/executor.mjs](../../src/local/executor.mjs) | 真实项目／host scope、选择 token、能力观察保存和验证 |
| [src/local/native-runtime.mjs](../../src/local/native-runtime.mjs) | 原生 RPC、runtime epoch、身份与响应核验 |
| [src/local/roster-status.mjs](../../src/local/roster-status.mjs) | 实际会话身份和有效 Model／Effort／Context 观察 |
| [test/capabilities.test.mjs](../../test/capabilities.test.mjs) | 原生 capability 观察、权限、未知／失效目录等测试 |
| [test/browser/panel.spec.mjs](../../test/browser/panel.spec.mjs) | 表单、目录、人数推导、项目切换及无误启动的回归 |

有源码修改后，在插件目录按变更范围验证：

```sh
npm run build
npm test
CI=1 PORT=4174 npx playwright test --fully-parallel --workers=4
npm run test:host
```

构建更新 `main.mjs`、`runtime-adapter.cjs`、`panel.html`；随包文件需要提交。功能修复后的下一发布号应从 0.1.17 只递增一步到 0.1.18，不因本次交接升版。正式执行前重新检查版本是否已由别人推进。

host contract 当前覆盖 Orca 1.4.222／1.4.223／1.4.229 的固定源码，属于契约检查，不等于三台真实宿主验收。修改注入／IPC 等边界时，按实际需要补独立 Electron fixture；不要无新变更重复所有测试。

## 9. 协作与操作边界

- 用户下一会话优先 #137，其后按实际 issue 前置和可用环境推进。代码阅读、准备、必要实现、常规测试和证据核对不反复询问确认；没有 Windows／SSH 环境时明确记录，不伪造通关。
- 默认用程序化读取和 CLI。需要用户操作时给清晰的实际入口、预期结果与少量步骤；不要抢占其窗口或自动做整段 GUI 控制。重启 Orca、睡眠、全局设置变更或确需接管界面的步骤，须有该步骤的明确安排。
- 过去为层级测试临时提高 nested worker depth 的授权已经完成，不能据旧记录再次改设置。遵守真实宿主深度，不以新 Run 绕过限制。
- 保留原生 consent、真实 panel／会话 ownership、准入、身份与配置版本；不手改 native profile／SQLite 或 Orca 安装包，不伪造 caller、回执、worker_done 或审核。
- unknown 不自动重试；输入受理、开始执行、任务完成、主管审核与用户答复是不同事实。模型目录记录也必须说明来源和可用性，不将网页登录信息复制进 prompt 或公开证据。
- 测试只清理其自身创建且身份已确认的资源；不关闭用户其他 session，不全量删除团队记录，不根据标题猜测资源归属。
- `/tmp` 中旧控制脚本、源码缓存和原始记录不是交付物；可能含固定 PID 或过期身份，不能直接当下一会话工具复用。原生运行时、会话及权限必须重新发现，不把 auth token 写入日志或仓库。

## 10. 建议下一会话的开场

读取本交接和 #137，确认当前代码／宿主／真实已开会话。用一张小表说明“已有能力、`hostDisabled` 的实际原因、终端与 Chat 差异、最小验证路径”，随后在 #137 范围内继续调查和实现。不要重新讨论已定稿的 Roster/New team 布局，也不要仅因旧 spec 出现被删除入口而恢复它们。

#137 的实现和证据完成后，再收尾 #125；之后根据 Windows／SSH 环境推进 #126–128，继而 #129 → #130 → #131。issue 结案依据新的验收正文及真实结果，不能仅按标签、评论数量或代码测试结果判断。
