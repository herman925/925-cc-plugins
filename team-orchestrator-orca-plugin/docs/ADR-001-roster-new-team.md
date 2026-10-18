# ADR-001：Roster 与 New team 的职责及最终交互

- 状态：已接受，本轮设计定稿。
- 决策日期：2026-10-18。
- 决策人：Lin；依据为本轮连续产品讨论及最终确认。
- 实现基线：插件 `0.1.17`，提交 `26bc866`。
- 范围：Roster、New team，以及两页依赖的主管交互、可用性与宿主能力边界。Settings 的整体设计不在本次定稿范围内。
- 关联历史：[2026-10-16 开发规格](../../docs/team-orchestrator-orca-spec.md)、[原版 Claude Code mod](../../team-orchestrator/README.md)。

## 背景与决策原则

用户日常关注最高主管的会话，通过它交办工作、了解结果并作决定。各 Lead 如何分工、如何与 Worker 沟通，由主管层级负责。用户在开始时配置人员和模型，Roster 用于观察团队是否推进工作。

原版 Claude Code Team Orchestrator 是参照，不是逐项复制的功能清单。新增到移植版、但原版没有的功能需要额外论证；原版已有的可选管理操作，也可按用户明确要求精简。本轮最终选择优先于讨论中的中间方案。

本 ADR 在其范围内取代旧规格中关于面板操作、模板交换、默认启动方式和总目标交互的冲突要求。原生权限、身份验证、持久化、未知结果不重复执行等工程约束继续有效。删除一个面板入口不意味着删除历史数据，也不意味着最高主管因此获得新的执行权限。

## 1. 页面分工与用户入口

| 位置 | 最终职责 |
| --- | --- |
| Roster | 查看当前项目中已启动团队的全员状态；进入最高主管会话；通过 Add team 进入 New team |
| New team | 配置名称、Function、人数、CLI、模型、effort；预览组织关系并 Launch team |
| 最高主管会话 | 交办业务目标、沟通进展与结果、回答问题、讨论并决定增员 |
| Settings | 保留连接检查等现有设置；本 ADR 不重新设计整个 Settings 页 |

最高主管是实际名册中没有上级的 Head；兼容历史团队时也可能是 CEO。不得另加隐藏主管。

Templates、复制团队、配置导入/导出入口已移除。用户认为建队足够简单，不需要独立的模板复用流程。

Attention / Need your attention 面板已移除。用户问题、失败升级、增员决定集中在最高主管的会话；不再要求到另一个面板作第二次确认。

不同 CLI 使用各自原生的提问方式：Codex 优先使用 `request_user_input`，Claude Code 使用 `AskUserQuestion`。判断依据是实际绑定会话的 CLI，而非将来启动用的偏好。只有工具在当前模式中暴露且允许使用时才调用；否则在同一会话直接提问，等待明确答复。空结果、取消、超时、预选项和沉默均不算同意。

已实现的会话决定协议验证最高主管身份、原生记录和配置版本；它认证的是“最高主管记录了用户答复”，不是独立认证的用户消息或提问工具回执。增员需要明确同意及现有权限检查；获准增加的成员由直属主管的首个合法任务启动，不因初始 All at start 设置而绕过任务准入。

## 2. Roster：全员监控，不承担个人管理

Roster 按 Orca 当前选中的项目过滤已启动团队。这里的“已启动”不等于每个人当前都在 Working；Idle、Not started、Unknown 等成员仍须可见，旧团队也不因没有正在执行的任务而消失。

保留的监控列为 Name、Role、CLI、Status、Context、Model、Effort。页面可见时约每 5 秒读取一次原生状态；显示必须来自当前、准确匹配的会话身份，不能沿用启动时的旧 Working 记录。

- Add team 保留在 Roster，包含空名册状态；点击只跳转 New team，不另建一套创建流程。
- 每个团队保留一个 Open supervisor 入口，定位已有的最高主管会话。身份失效时报告失败，不能顺便创建替代会话。
- 成员名字与组织图只读，不打开个人详情或下属会话管理表单。
- 移除成员角色说明、工作习惯、协作规则、个人模型偏好、暂停派工、停止、替换、唤醒及恢复诊断等详情入口。
- 移除会话回执列表、内部 request/instance 信息、团队派工开关等面板块。
- 移除 Start team work、Submit total objective、Next total objective，以及总目标队列、交付验收表单。

新团队采用 `supervisor-session` 工作方式：真实主管会话可用后自动提供协调协议，用户直接在该会话交办工作。原生 Task/Dispatch 的证据核验与逐级审核仍然保留。旧目标、队列、验收及恢复记录保留兼容，不作为新 Roster 操作流程恢复。

正常持续会话中的后续交办继续使用该主管及其协调 Run，不套回旧规格“每次面板总目标都必须新建对话”的产品流程。会话或权威失效仍按现有证据规则处理，不能由面板刷新暗中重开主管。

### 状态与显示真实性

Context 无观测时显示 `—`，不能显示成 0%。估计值需标记为估计，不能把输出 token 当作当前上下文占用。有效 Model/Effort 只有获得 provider 确认才按实际值呈现；未确认的配置显示 `set`，不得宣称已生效。

`terminal_handle_stale` 表示保存的终端标识已失效，不能仅凭同名 tab 重新认定身份。它不证明任务失败或文件丢失；无可靠身份时显示 Unknown，不自动重复启动。个别成员 Unknown 与整个插件不可用是不同情况。

## 3. New team：由人数推导层级

最终表单没有 Structure 或 Levels 选择器，也没有 Quick start、Squad/Tech Team 等预设列表、Head only、独立 CEO/部门名称创建流程。

人员配置仅有两个字段，默认 Leads = 1、Workers per lead = 3，当前各支持 1–5：

| 输入 | 实际名册 | 总人数 |
| --- | --- | --- |
| Leads = 1，Workers per lead = W | 一个最高主管 Head，直接管理 W 个 Worker；不额外增加中间 Lead | `1 + W` |
| Leads = L > 1，Workers per lead = W | 一个 Head，管理 L 个 Lead；每个 Lead 管理 W 个 Worker | `1 + L + L × W` |

例如 Leads = 2、Workers per lead = 3，生成 1 Head + 2 Leads + 6 Workers，共 9 人。Workers per lead 是每位主管所带的 Worker 数量，不是全队 Worker 总数。单主管模式的那位负责人在内部和名册中仍叫 Head，这是用户所述“1 个 Lead 相当于 Head → Workers”的映射。

预览、模型配置行与保存时的层级使用同一规则。更改 Lead 数量时，Head 和 Worker 的 CLI/模型/effort 继续属于原角色；中间 Lead 的配置在当前表单内暂存，切回多 Lead 时恢复。不得把原 Worker 的模型意外当成新增 Lead 的模型。

Team name 与 Function 保留；Function 描述团队用途，不是要求用户另行提交的面板总目标。业务任务在最高主管会话中交办。

### 项目和执行主机自动识别

移除 Project and execution host 设置区、Confirm project and host、Refresh workspace。仅保留一行只读项目名称提示。

打开 New team 时从 Orca 当前桌面选择读取项目及执行主机。页面跟随项目切换而保留表单草稿；点击 Launch team 时再次读取当前位置，使用原生生成的选择 token 保存绑定。创建后的整次启动使用已保存的项目/主机，随后切换焦点不能将剩余成员启动到另一个项目。

没有有效项目、主机证据缺失或身份已变化时停止创建，不能回退到旧项目或猜测本机。内部 scope、权限与身份检查仍须执行；移除用户确认按钮不等于取消这些检查。也不以 CLI 的 cwd 或 `active` 推测用户当前在 Orca 选中的项目。

### CLI、模型和 effort

按实际层级提供 Head、Leads（仅多 Lead）、Workers 的配置行，支持 Codex / Claude Code。

模型通过已选项目的 Orca 原生 `agentSession.modelCatalog` 读取，并呈现为下拉列表；effort 随该模型的宿主返回值变化。移除模型名称的自由输入框，不硬编码一份假定可用的模型表。

Default 继承 Orca 配置。切换 CLI 时重置该角色的模型/effort，切换模型时重置 effort；仅改变人数时保留角色配置。正在列举模型时进行有限、避开宿主限流窗口的重试，并提供 Refresh models。目录未知、宿主不支持或无法确认远端目录时，仅允许继承 Default；不能用本机列表替代 SSH 主机的有效目录。

### Launch team 与会话命名

新团队固定 All at start，不提供 Preparation mode 选择器。Launch team 先保存名册、配置、项目和稳定操作身份，再按主管优先顺序准备全部成员；启动按宿主限流分步进行，不承诺所有会话瞬间同时就绪。

会话建立、输入受理、agent 开始处理及任务成功是不同证据。未知结果保留原操作和成员预留，不自动重发或创建第二份会话。

已核验的终端会话会通过原生 `terminal.rename` 命名为 `团队名/成员名`，包括 Head、Lead、Worker。这是 Orca 终端显示标题，不等同于 CLI 内部 `/rename` 或 provider 对话身份。当前集成没有原生 Chat 标题重命名能力。

旧的按需启动配置、CEO 组织、仅 Head 的历史团队仍可读取；本轮不迁移或重组既有团队。`leadCount`、`workersPerLead` 缺失时，旧配置继续按原有 `fan` 语义解释。

## 4. 可用性与兼容原则

连接和保存数据都验证成功后才展示正常导航与内容。插件连接或存储不可用时只展示 Plugin unavailable、Retry 和可选 Details，不同时呈现缓存名册或误导性的“没有团队”。正常连接诊断放在 Settings → Connection，技术细节默认折叠。

兼容性依据必要运行时能力、原生 handler 契约与证据格式检查，不按 Orca/Electron/Node 的确切版本号一律拒绝更新。缺少必要接口或证据格式不兼容时明确失败；通过连接检查不代表真实团队协作已验收。

## 5. 原版参照与有意保留的差异

原版 Roster 同样显示成员状态、Context、Model、Effort，也提供可选成员管理操作。本插件删去这些管理入口，是本轮用户明确的分工选择，不能表述为“原版完全没有成员管理”。

原版普通三层团队的 Lead 默认使用编号和相同的管理职责：接收上级工作、分配给直属下属、审核结果。`name` 与自由文本 `role` 是分开的字段；角色文件保存职责，具体工作由 Head 的任务指令分配。没有按名字自动分配开发、测试等专业方向的代码规则。当前表单不增加专业岗位编辑器；用户可以在最高主管会话明确业务分工。参见[原版创建与工具定义](../../team-orchestrator/hooks/register.tsx)、[原版角色文件](../../team-orchestrator/hooks/roles.ts)。

原版默认 On demand，并保留 All at Create。本插件采用 All at start 是用户明确选择，不是误认为原版默认全部启动。

2026-10-18 对 Herman 记录的调查仅作为背景，不改变该决定：

- [0.5.03 引入按需启动](https://github.com/herman925/925-cc-plugins/commit/c19a88961f46ff48b834fd110d84f4d831a87fba)：完整名册先保存，下属首次收到上级消息时启动，并采用分批准备。
- [Issue #38](https://github.com/herman925/925-cc-plugins/issues/38)：记录 2026-10-08 的 14 会话团队带起约 140 个闲置浏览器服务进程。
- [0.5.0 卡顿修复](https://github.com/herman925/925-cc-plugins/commit/ddd0d4650487b65c9880b154b055e9667ab3ff3d)：明确记录逐个轮询 14 个会话屏幕造成 Orca 卡顿。
- [0.5.31 后续修复](https://github.com/herman925/925-cc-plugins/commit/86c0b561c28fa30608f2c4b4a5468bbfe920fcd4)：关闭成员的浏览器自动化插件，减轻闲置服务开销。

资源与启动开销是这些记录支持的设计动机推断，未取得 Herman 明确解释默认值的完整原始对话；不能将推断写成他的原话，也不能将历史进程负担当作当前版本的实测结果。用户未要求恢复 On demand 或重新加入模式选择器。

## 6. 已撤回或被替代的中间方案

| 中间方案 | 最终决定 |
| --- | --- |
| Roster 不放 New team / Add team 按钮 | 后来明确恢复 Add team，直接跳转 New team |
| Structure 与 Levels 分开选择 | 先合并，最终都取消；由 Lead 数量推导 |
| 两层显示不可编辑的 Head = 1，三层才显示 Leads | 最终统一显示可编辑的 Leads；1 位对应单主管，超过 1 位增加 Head |
| 一个 Reports each 同时决定 Lead 和 Worker 数量 | 分开配置 Leads 与 Workers per lead |
| 成员详情中修改角色、模型、控制会话与查看诊断 | Roster 只读监控，个人管理表单移除 |
| 用户手动填写模型 ID | 从宿主目录选择，未知时 Default |
| 手动确认项目和执行主机 | 自动读取当前选择，Launch 时重读并绑定 |
| Preparation mode 可选 On demand / All at start | 新团队固定 All at start，旧团队不改写 |
| 调查原版默认按需启动的原因 | 仅记录依据与推断，没有新产品决策 |

未来明确的新需求可以由后续 ADR 替代相应条款；不要根据旧规格、历史交接或原版仍有某功能，就推定需要恢复已删除入口。普通修复继续遵循本 ADR 的最终行为。

## 7. 已知限制与验证边界

| 项目 | 截至本 ADR 的事实 |
| --- | --- |
| 当前终端遥测 | 活动状态可读；原生接口未提供可靠的 Context 与有效模型/effort 时显示未知或标注配置 |
| 本机模型目录 | 本轮检查 Orca 1.4.229 时返回 `hostDisabled`；自动读取入口已接入，但当时该机只能使用 Default。并非断言所有 Orca 安装都如此 |
| SSH 模型目录 | 当前集成不能将本机目录当作远端能力证明 |
| 原生 Chat 命名 | 尚未支持标题重命名 |
| 被删管理入口 | 后端历史和恢复校验仍保留；没有因此承诺主管可代行所有暂停、替换、恢复等操作 |
| 实现验证 | `26bc866` 对应 561 项核心测试、26 项浏览器测试及 3 个固定 Orca 源码版本兼容检查通过；页面在 320px 宽度下检查通过 |
| 实机连接 | 本轮本机 Orca 1.4.229 已载入插件 0.1.17，连接与已有团队读取成功；不等于本轮新建真实团队并完成业务任务 |
| 跨平台及规模 | 本 ADR 不宣告 Windows、SSH 或 11/21 人真实协作验收完成；既有实机证据见 [validation](validation/) |

本 ADR 是文档归档，不触发插件版本升级、重新启动团队、修改宿主设置或重跑真实 provider 工作。

## 8. 实现与历史索引

- [面板与表单](../src/panel.mjs)、[团队结构](../src/team.mjs)、[启动 brief](../src/launch.mjs)。
- [原生状态读取](../src/local/roster-status.mjs)、[模型能力读取](../src/local/capabilities.mjs)、[主管会话决定协议](../src/local/session-decisions.mjs)。
- [项目绑定与创建](../src/local/executor.mjs)、[原生启动和命名](../src/local/native-broker.mjs)。
- [面板回归测试](../test/browser/panel.spec.mjs)、[保存回归测试](../test/browser/storage.spec.mjs)。

| 提交 | 本轮决策落地 |
| --- | --- |
| `74242cf` | 移除模板与复制团队 |
| `31faed9` | 会话内决定与移除 Attention |
| `5f98006` | 不可用时仅展示错误入口 |
| `6af4fde` | 基于实际契约的兼容检查 |
| `40664a1` | Roster 监控及主管会话工作方式 |
| `4d649f2` | 移除成员详情与管理入口 |
| `b727b9d` | Add team、精简创建、宿主模型选择、全部启动 |
| `ed81af6` | 独立人数设置及自动项目识别 |
| `26bc866` | 由 Lead 数量推导最终层级 |
