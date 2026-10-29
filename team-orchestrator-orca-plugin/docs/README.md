# 插件文档索引

## 已接受的架构与产品决策

| ADR | 状态 | 范围 | 实现基线 |
| --- | --- | --- | --- |
| [ADR-001：Roster 与 New team](ADR-001-roster-new-team.md) | 已接受，2026-10-18 更新至 0.1.23 | 两页职责、人数推导、Lead／Worker 命名、稳定模型选择、全员会话跳转与 Context、主管交互、启动及项目绑定 | 0.1.24 |

调整 Roster 或 New team 前先阅读 ADR-001。它记录本轮用户最终选择，以及对原版和旧规格的有意取舍；发布说明中的中间方案不能覆盖最终决策。

## 使用、历史规格与验证

- [2026-10-18 最新交接：0.1.20 与下一轮实机测试](handoff/2026-10-18-v0.1.20-next-session.md)：从 Mac 本机“1 个主管＋3 个 Worker”的真实工作开始，补 #125／#137 剩余证据。
- [2026-10-18 前一交接：0.1.17 模型目录调查背景](handoff/2026-10-18-model-catalog-and-remaining-issues.md)：历史记录；其中尚未实现、下一版本及优先调查目录的描述已由最新交接替代。
- [插件 README](../README.md)：使用入口、运行原理及当前限制。
- [#137 模型目录验证](validation/model-catalog-137.md)：0.1.18 的真实 CLI 目录、插件下拉框与剩余验证边界。
- [Lead 名称与稳定模型回执](validation/lead-names-and-stable-models.json)：0.1.19 的名称校验、预览和模型显示稳定性。
- [0.1.23 派工深度准备](validation/dispatch-depth-023.md)：本机三层团队在启动前确认原生深度至少 2，保留更高设置及既有会话。
- [0.1.22 Claude statusline Context](validation/claude-statusline-context-022.md)：保留已有 statusline，读取 CLI 上报的窗口与百分比；本机三个 Worker 实测 1M。
- [0.1.21 成员跳转与终端 Context](validation/roster-navigation-context-021.md)：列表／组织图直达成员会话，补上本机终端的真实上下文用量；四人现有会话实测。
- [Worker 前缀命名回执](validation/worker-name-prefixes.json)：0.1.20 的单主管／多主管 Worker 命名。
- [2026-10-16 开发规格](../../docs/team-orchestrator-orca-spec.md)：历史契约；与 ADR-001 冲突的相关条款已由后者替代，其余工程边界仍保留。
- [原始宿主分析](../../docs/team-orchestrator-orca-analysis.md)：按其记录日期和版本理解，不作为当前完成状态。
- [macOS 本机 #125 验证](validation/macos-local-125.md)、[#120–124 验证](validation/ready-agent-120-124.md)、[终端命名验证](validation/member-terminal-names.md)。
- [2026-10-16 交接](handoff/2026-10-16-post-136-next-session.md)：历史阶段信息，界面决策以 ADR-001 为准。
