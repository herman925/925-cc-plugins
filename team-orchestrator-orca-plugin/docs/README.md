# 插件文档索引

## 已接受的架构与产品决策

| ADR | 状态 | 范围 | 实现基线 |
| --- | --- | --- | --- |
| [ADR-001：Roster 与 New team](ADR-001-roster-new-team.md) | 已接受，2026-10-18 定稿 | 两页职责、人数推导、主管交互、启动、模型及项目绑定 | 0.1.17 / `26bc866` |

调整 Roster 或 New team 前先阅读 ADR-001。它记录本轮用户最终选择，以及对原版和旧规格的有意取舍；发布说明中的中间方案不能覆盖最终决策。

## 使用、历史规格与验证

- [插件 README](../README.md)：使用入口、运行原理及当前限制。
- [2026-10-16 开发规格](../../docs/team-orchestrator-orca-spec.md)：历史契约；与 ADR-001 冲突的相关条款已由后者替代，其余工程边界仍保留。
- [原始宿主分析](../../docs/team-orchestrator-orca-analysis.md)：按其记录日期和版本理解，不作为当前完成状态。
- [macOS 本机 #125 验证](validation/macos-local-125.md)、[#120–124 验证](validation/ready-agent-120-124.md)、[终端命名验证](validation/member-terminal-names.md)。
- [2026-10-16 交接](handoff/2026-10-16-post-136-next-session.md)：历史阶段信息，界面决策以 ADR-001 为准。
