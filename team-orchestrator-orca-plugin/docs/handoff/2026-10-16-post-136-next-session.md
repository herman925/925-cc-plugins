# Orca Team Orchestrator：0.1.11 后续交接

交接日期：2026-10-16。下一阶段转入人工配合验收，先核对 #125 已有证据及收尾边界，再按用户可用环境推进其他人工票。本次只写交接，不启动新的测试、不改票、不提交或发布此文件。

## 开始前阅读

- [插件工作规则](../../AGENTS.md)、[当前 README](../../README.md)。
- [父 issue #106](https://github.com/herman925/925-cc-plugins/issues/106) 和下一张实际获用户指定的票：重新读取最新正文、评论、标签和 blocking links。
- [本批 #120–124 验证记录](../validation/ready-agent-120-124.md)与[脱敏回执](../validation/ready-agent-120-124.receipts.json)：具体案例、身份、时间、证明哈希和覆盖边界均已保存，不重抄、不重做。
- [#125 既有实机记录](../validation/macos-local-125.md)与[回执](../validation/macos-local-125.receipts.json)，以及 [#125 评论](https://github.com/herman925/925-cc-plugins/issues/125)。旧报告有当时版本和保留现场描述，当前安装/清理状态以本交接为准。
- [成员命名记录](../validation/member-terminal-names.md)。
- [已发布规格](https://github.com/herman925/925-cc-plugins/blob/ac75ae15fedd13a08c970a0756934afaa376f3b3/docs/team-orchestrator-orca-spec.md)。此前交接 [2026-10-16-next-session.md](2026-10-16-next-session.md) 是前一批起点，其“#120 未开始”等状态已过时。

## 当前代码和已完成工作

`main`、`origin/main` 和本机工作目录已同步至 **dd81420f2092156e5bbf6df2bd309f7333f39862**，即已合并的 [PR #136](https://github.com/herman925/925-cc-plugins/pull/136)。正式版本 **0.1.11**。

#120–124 的现有功能先经过真实 Orca 测试，再修复实际发现的三类历史清理阻塞。最终源提交、单一发布 agent 提交、原生用例、修复原理及验证边界请查本批验证记录。最终 526 项 domain/bridge、64 项浏览器、两个固定宿主契约、构建/版本/产物检查均通过；独立 Spec 与 Standards 审查均无剩余发现。没有待修代码或待合并分支。不要仅为接续会话重复全套验证或重做既有实现。

真实三层派工已跑通 Head→Lead 自己的 Run→叶节点，叶节点完成、Lead 验收并沿原父 Dispatch 回报、最高 Head 验收、用户接受更正总交付。它证明小规模真实层级，不证明 11/21 人负载。

## 最新 GitHub 前沿与“有评论是否完成”

本次写交接时重新核对：**没有开放的 ready-for-agent 票**。#120–124 已关闭；#106 仍开放；#125–131 全部 OPEN / ready-for-human。

| 票 | 当前证据与下一步 |
| --- | --- |
| [#125 macOS/本机](https://github.com/herman925/925-cc-plugins/issues/125) | 有大量真实通过证据：Git/普通文件夹四人混合闭环、两种启动模式、依赖/冲突、失败升级、Wake、重启恢复、真实睡眠唤醒、执行中 Stop 等。正文前六项已勾选；评论明确保留人工标签和开放状态。单独撤权 UI 不可用、其他 backend 故障变体等边界仍明确未验证。先核对证据和必要缺口，请用户决定人工收口；不要要求全套重跑。 |
| [#126 Windows/本机](https://github.com/herman925/925-cc-plugins/issues/126) | 当前无评论、无本批实机完成证据。需真实 Windows 环境；兼容层仍严格拒绝未验证平台/build，不能仅删 gate。 |
| [#127 macOS/SSH](https://github.com/herman925/925-cc-plugins/issues/127) | 当前无评论、无本批实机完成证据。有用户可用 SSH 环境时可优先安排引导验收。 |
| [#128 Windows/SSH](https://github.com/herman925/925-cc-plugins/issues/128) | 当前无评论、无本批实机完成证据。需 Windows 与 SSH 组合。 |
| [#129 两人自用交付](https://github.com/herman925/925-cc-plugins/issues/129) | 当前无评论；原生依赖 #120–128，尚被开放的 #125–128 阻塞。0.1.11 已交付不等于“两人跨环境安装验收”已完成。 |
| [#130 11 人](https://github.com/herman925/925-cc-plugins/issues/130) | 当前无评论；被 #129 阻塞。小规模三层成功不能替代真实负载。 |
| [#131 21 人](https://github.com/herman925/925-cc-plugins/issues/131) | 当前无评论；被 #130 阻塞。 |

Comments 是过程和证据记录，不是整票完成标记；但 OPEN / ready-for-human 也不等于从未做过或全部需要重测。尤其 #125 的开放包含用户要求保留状态这一因素。判断要看实际证据、未验证范围、验收条件和用户决定，不能用“有评论”“已勾很多项”或“开放”单独推断。

## 用户新增协作要求：以引导代替抢占界面

用户明确反映 Computer Use 严重抢占工作页面，希望下一阶段需要其操控时，由 agent 引导其完成以加快进程。

1. 默认不调用 `orca computer`，不自动切换/聚焦窗口、点击、截图或键盘输入。CLI 能做的读取、准备、代码分析、修复、构建和证据核对由 agent 完成。
2. 需要 UI 时给用户每轮 1–3 个具体步骤：入口、按钮/字段、预期结果，以及只需回报的一行状态。等待实际反馈再做依赖该步骤的后续动作；不要把发出指引当成操作成功。
3. 优先通过 CLI 和已知精确作用域核对反馈，避免反复索取截图或大段完整对话；不需要密码、token 或敏感日志。
4. 用户可点击建队、授权、启动、暂停/停止、接受交付等界面动作；agent 在后台核对真实 Run/Task/Dispatch、报告、审查与状态。原生 worker 的协调仍用真实 owning agent 权威，不伪造身份。
5. 重启 Orca、物理睡眠、全局设置变更会打断工作，必须等用户明确安排。若特定一步确实需要 agent 接管 Computer Use，先说明必要性和最小操作范围，得到该次明确许可后再做；不要默认恢复整段自动控制。
6. 一次安排一个小场景并及时清理；复用已有有效证据，只补必要缺口，不重复让用户操作已通过的场景。

## 持续有效的范围与测试约定

- 默认只改仍带 ready-for-agent 的票；ready-for-human 不自行改标签、正文、评论或关闭。用户可明确指定人工票的协助/验证范围；此前 #125 实测例外不等于其他人工票全部开放。本轮新偏好只确定协作方式，未授权全面执行或关闭所有人工票。
- 下一会话若用户尚未指定票，先做只读差距核对，给出 #125 最小收尾清单，再确认当前人工验收目标。不要因为开发票已清空而自行扩展到 Windows、SSH 或负载测试。
- Codex 测试用 **gpt-6.1-sol / medium**；Claude Code **默认模型 / 默认 effort**。不改写历史测试实际模型；默认不代表某个固定 Anthropic 型号。
- 后续若发现需修源码，先保留真实复现，再修复、审查、按变更验证。本批源码修改全部合并后仍由**一个指定子 agent 统一更新一次版本和打包产物**；纯交接无需升版。
- 保留原生 consent、panel ownership、admission、实际 Head/Run/Task/Dispatch/worker_done/直属审查。禁止手工改原生 profile/SQLite 或 Orca 安装包、伪造 caller/回执/报告、用新 Run 绕过拒绝。
- unknown 不自动重试；输入受理不等于执行，worker 完成不等于主管/用户验收。终端和资源操作使用精确 handle/workspace/host，不用焦点或标题代替身份。
- 简洁中文解释。已授权的日常后台操作不反复问确认；UI 步骤按用户新偏好引导。

## 安装、全局设置与清理后的真实状态

正式原生 Development path 已恢复为仓库的 `team-orchestrator-orca-plugin/`。0.1.11 连接检查通过、持久存储加载、空名册。最近 stock 环境为 macOS arm64 Orca 1.4.223 / build ff4a51c872e723d87ab141044814301ea5a78634，Electron 43.7.5 / Node 24.21.0。运行时会变化；下一会话需要时通过 CLI 重新发现，不沿用旧 PID/handle。

用户曾明确批准为 #124 临时把 Nested worker depth 1→2；完成后已通过原生 UI 恢复 **1**，并只读核验权威 `profile-state.db` settings revision **19851**。该授权已经完成，不构成未来再次改设置的许可。旧 `orca-data.json` 是迁移快照，不能用于判断实时设置。11/21 人可能需要用户再安排深度 2，不自行更改。

所有本批测试 agent/终端、测试 project/worktree、独立 profile、测试专属 Claude 目录、临时候选、截图、日志和私有原始证据已清理。测试专属插件数据库是在停用、写入者退出、验证三 Work 已结案/清理且零活动指针后移除；正式重新加载为空名册。产品“手动清理历史”与这次操作员测试环境拆除不同，不能声称产品会删除团队或原生/provider 全对话。

原桌面和两条既有终端保留。Git worktree 只剩主目录；临时分支/合并提交仍可追溯。**`/tmp/orca-120-session`、`/tmp/orca-120-project`、`/tmp/orca-122-live`、`/tmp/orca-121-fix`、`/tmp/orca-release-batch` 已不存在**，不能引用其中脚本或恢复旧测试身份。正式脱敏证据已在仓库提交。

用户原有未跟踪 `GLOSSARY.md`、根目录 `docs/` 的规格/分析和本 handoff 目录均保留；不要 `git clean`、全量 `git add` 或捎带提交。

## 推荐下一会话的第一轮

1. 读本交接、#125 报告和最新评论，只读核对最新 GitHub/代码/安装信息。
2. 提交一张简短差距表：已有真实证据、仍缺必要操作、宿主不提供的能力；不要把所有未测试变体都变成新的强制测试。
3. 用户选择 #125 收尾后，以每次 1–3 步引导其完成必要 UI，agent 后台核对和记录。保持标签/开放状态，直到用户另行决定。
4. 随后按环境安排 #127 macOS/SSH 或由具备 Windows 环境的人处理 #126/#128；遵守最新依赖。#129→#130→#131 按实际前置完成再推进，不能用本机证据外推。

## Suggested skills

- **handoff**：本技能在 `/Users/lin/.cc-switch/skills/handoff/SKILL.md`。用户指定仓库目录优先于技能默认临时目录。
- **implement-spec**：继续开发时用；`/Users/lin/.codex/skills/implement-spec/SKILL.md`，结合最新标签和用户范围，不自动接管人工票。
- **orchestration / orca-cli**：真实 Orca 后台读取、监督及作用域资源管理。入口 `/Users/lin/.agents/skills/orchestration/SKILL.md`，用 `orca skills get orchestration` / `orca skills get orca-cli` 读当前 binary 指南。协作权威来自真实 Orca。
- **tdd / code-review**：确有源码缺陷时使用；此前路径在 `/Users/lin/.codex/.tmp/marketplaces/mattpocock/skills/engineering/`，先确认存在，独立做 Spec/Standards 审查。
- **computer-use**：仅在用户明确授权该次接管时使用，并先读本机当前指南；默认走用户引导流程。

## 2026-10-16 晚间接续：用户暂停到明天

用户最新授权：按证据验收，已通过的 GitHub issue 可直接关闭；未通过保留。因此上文“必须保持 #125 开放直到另行决定”的旧限制已被替代。此次核对仍未关闭 #125：现有报告与脱敏回执支持六个完成 Work、重启恢复、45 秒睡眠和执行中 Stop；但未找到明确的焦点切换前后 scope/目标对照，不能只凭已勾选判通过。核验已记录在 https://github.com/herman925/925-cc-plugins/issues/125#issuecomment-6214959287 。#126–131 与父票 #106 仍开放。

本轮用户在 0.1.11 面板确认连接成功（worker 8437），创建 `QA125-Focus`：team `4e612b77-a0f8-4343-841a-5e114d6628c5`，本机 Git 项目 `/Users/lin/Workspace/925-cc-plugins`，四人 Squad、on-demand，Head Codex gpt-6.1-sol/medium，三位 Worker Claude default/default。只启动了 Head，其准备会话已确认真实角色并等待目标。暂停时只读插件数据库仅有该 Head 的 binding/operation 两条 receipts，没有 TeamWork；焦点切换/任务执行尚未取得结果。

用户明确要求“先不处理了，关闭相关的tab，我会明天再继续”。已通过原生 CLI 精确关闭 Head `term_15174a5b-728a-401c-9411-ca45453936d1`，原 tab `76882946-30d6-4787-bd9f-ec30fd907cc7`，close 回执 `ptyKilled:true`，再次列举确认消失。该 handle/pane/incarnation 与插件保存记录逐项匹配，并读取准备对话确认归属后才关闭。原两条既有终端保留；团队记录、项目文件和插件面板未删除，未修改原生或插件数据库。

明天接续先处理“已关闭准备 Head”的真实状态，不沿用原 live 假设、不重复 Launch 绕过 reservation。根据正常产品恢复入口核对能否恢复，必要时明确说明受限点。最少验收仍是一个受控焦点切换场景：A 为 925-cc-plugins，B 为另一个本机项目；切换 B 后，核对原团队的保存 scope、原生 Task/Dispatch 和执行 cwd 仍属于 A。不要要求重跑既有四人全矩阵、重启、睡眠或 Stop。用户操作界面，agent 后台核验；用户随后要求可一次给较完整步骤，但应使用清楚的实际入口和按钮文字。
