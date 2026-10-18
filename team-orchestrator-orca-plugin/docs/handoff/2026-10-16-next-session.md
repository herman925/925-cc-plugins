# Orca Team Orchestrator 后续工作交接

交接日期：2026-10-16。下一会话用于继续剩余开发与实机验收，建议从 #120 开始。本文件只交接上下文，不要求在读取后立即启动测试。

## 第一轮阅读与核对

以仓库根目录为工作目录，先读以下资料，再读取 GitHub 最新标签、依赖和评论；不要只依据本交接的状态快照行动。

- [插件工作规则](../../AGENTS.md)
- [当前插件 README](../../README.md)：架构、安装、平台限制和各功能的实现边界。
- [父 issue #106](https://github.com/herman925/925-cc-plugins/issues/106)：总目标和子票。
- [已确定的规格](https://github.com/herman925/925-cc-plugins/blob/ac75ae15fedd13a08c970a0756934afaa376f3b3/docs/team-orchestrator-orca-spec.md)：引用已发布版本；根目录也保留了本地规格副本。
- [现有 macOS 实机记录](../validation/macos-local-125.md)及[回执摘要](../validation/macos-local-125.receipts.json)。
- [成员命名实机记录](../validation/member-terminal-names.md)。

用户希望简洁、具体的中文说明，不需要反复要求确认已经授权的操作。执行中及时汇报已确认的事实和下一步。

## 当前代码与安装状态

- `main`、`origin/main` 和用户工作目录在本次结束时一致：`940765b604033d095319b2f11dd68094dcbcffa0`。
- 最新版本为 **0.1.10**，最后一次交付是已合并的 [PR #135](https://github.com/herman925/925-cc-plugins/pull/135)。此前 PR #132、#133、#134 也已合并。
- 实际 Orca 插件已切换到**本仓库的 `team-orchestrator-orca-plugin/` 正式目录**，通过原生 Settings → Plugins 的 Development path 加载。0.1.10 连接检查通过。
- 最近运行环境为 stock macOS arm64 Orca 1.4.223，构建 `ff4a51c872e723d87ab141044814301ea5a78634`，Electron 43.7.5 / Node 24.21.0。重新发现实际环境，不沿用旧 PID、窗口 ID 或 terminal handle。
- 当前兼容检查明确拒绝未经验证的 Windows/build。Windows 工作包含平台适配和真实执行验证，不能仅删除拒绝条件。
- 原版 Claude Code mod 在 `team-orchestrator/`，与当前 Orca 插件是独立产品。原版 README 中介绍 Orca 版的部分仍有旧描述，判断当前能力应以插件源码、README 和实机记录为准。

最近完整验证为 **472 项 domain 测试、63 项 UI 测试、两个固定宿主版本契约检查通过**；独立 Spec、Standards 审查复查均无剩余发现。不要仅为接续会话重复跑全套；按后续实际改动选择检查。

## 用户持续有效的要求

1. 默认只处理仍带 `ready-for-agent` 的子票。`ready-for-human` 票不要自行改标签或关闭。
2. 用户曾明确允许进行 #125 本机实测，但要求保留其人工标签和开放状态。该例外不代表其他人工票已开放。
3. 已经实际验证通过的对应工作可以更新 GitHub、合并分支、关闭对应开发票；不能把源码实现、fixture 通过或输入已受理写成实机通过。
4. **版本号和打包产物：一个批次的源码修改、修复及审查合并之后，由一个指定子 agent 统一更新一次。** 不按每个修复分别升版。
5. 后续测试中的 Codex 使用 **gpt-6.1-sol / medium**；Claude Code 使用**默认模型 / 默认 effort**。保留 Codex／Claude 混合验证；历史完成记录不改写模型。
6. Claude Code 的默认后端以实际配置与观测为准，不能假定其一定是 Anthropic 某型号。不要输出凭据或敏感会话内容。
7. 用户刚要求清理测试项目和过程文件，清理已完成。下一批若需要测试环境，控制数量，验证结束后及时移除；不要长期累积 project、会话、worktree、候选包和日志。

## GitHub 前沿

截至交接时，#107–#119 已关闭；#106 开放。以下五票开放且为 `ready-for-agent`，前置依赖均已关闭。它们已有源码和自动化覆盖，仍保留开放是因为实机验收尚未补齐，后续可能继续发现需要修复的问题。

| 顺序 | Issue | 下一会话关注点 |
| --- | --- | --- |
| 1 | [#120 工作中增员](https://github.com/herman925/925-cc-plugins/issues/120) | 主管建议的批准／拒绝、直接新增、名册更新、重复确认、两种启动模式与失败路径 |
| 2 | [#121 更换 agent 与组织调整](https://github.com/herman925/925-cc-plugins/issues/121) | 空闲替换、忙碌／unknown 拒绝、交接、结案边界的组织变更 |
| 3 | [#122 团队模板](https://github.com/herman925/925-cc-plugins/issues/122) | 配置导出、预览、独立身份、另一 profile 导入与角色重读 |
| 4 | [#123 数据与历史清理](https://github.com/herman925/925-cc-plugins/issues/123) | 迁移、备份、故障和清理预览；破坏性故障注入放在隔离副本 |
| 5 | [#124 多层派工](https://github.com/herman925/925-cc-plugins/issues/124) | 真正的下层主管 Run、原生父子权威、逐级审查；不要等同大型负载验收 |

#125–#131 均保持 `ready-for-human` 且开放：本机收尾、Windows、SSH、两人安装交付及 11／21 人负载。仓库还有原版 mod 的其他开放票，当前授权的开发范围仍以 #106 子票和用户后续明确指示为准。

**#120 的新一轮实机验证尚未开始。** 本次只完成清理与 issue 检查，没有偷偷建立新的测试项目。

## 本次清理后的状态

- `git-project` 和 `folder-project` 已从 Orca 原生项目设置移除，13 个测试终端已确认停止。
- 四个 QA 团队及其测试专用插件数据已在插件停用、写入者退出后清除；插件重新启用后确认为空名册、连接正常。原来的测试 Run／handle 不再是后续工作入口。
- 测试项目、候选插件副本、原始私有证据和约 1.3 GB 临时构建／日志／研究文件已删除。正式仓库内的已提交验证文档仍保留。
- 七个临时 Git worktree 已移除，提交与分支保留。当前 `git worktree list` 只有主工作目录。
- **旧 `/tmp/orca-106-context`、`/tmp/orca-125-context`、`/tmp/orca-member-names-context` 及其中脚本已删除，不要引用或期待恢复它们。** 固定 Orca 源码临时 clone 也已删；宿主检查可能需要重新下载。
- 用户已有未跟踪文件 `GLOSSARY.md`、`docs/team-orchestrator-orca-spec.md`、`docs/team-orchestrator-orca-analysis.md` 原样保留。不要用 `git clean` 清掉它们，也不要无检查地捎带提交。
- 本交接文件按用户要求写入仓库目录；仅创建文件，未自行提交或发布。

## 最近命名修改的边界与实测阻塞

具体实现、回执及验证边界引用 [PR #135](https://github.com/herman925/925-cc-plugins/pull/135) 和[验证记录](../validation/member-terminal-names.md)，不要重做同一功能。

后续调试须记住：

- `terminal.show/list` 的 `title` 可能是 provider 生成的 OSC 标题，并不等于界面自定义标签；不要据它反复改名。
- 终端命名不会取得 Codex 的 provider conversation ID，也不解决完整原会话恢复。结构化聊天命名仍不支持。
- 最近三名 Codex worker 的自动命名和插件重载保留名称已经实测通过；同批正常任务执行却被 Codex 更新选择提示阻塞，原生结果为 `agent_readiness` 失败，**没有算任务执行／交付通过**。未升级 Codex CLI。
- 新测试要及早识别这种原生启动提示。跳过更新的真实终端按键属于用户接管路径，可能使 worker 资源显示 `user_owned`；自动 `terminal.rename` 本身不会转移资源所有权。不要靠伪造成功或重复启动绕过。

## 执行规则与操作经验

- 真实测试使用实际 Head 持有的 Run、Task／Dispatch、worker_done 和直属主管审查；禁止伪造 caller／`--from`、原生回执或完成报告。
- 不手工修改 Orca 的原生 profile／SQLite 来制造状态，不修改已安装 Orca。插件的兼容层必须保留原生 consent、panel ownership 和 admission 检查。
- unknown 保留现场并对账，不能自动重复效果。权限检查成功与会话就绪、输入受理与任务完成分别判断。
- 主管的工作和测试均绑定明确 workspace／host；不要使用画面焦点或同名标题代替身份。终端操作始终带明确 handle。
- 用本机 `orca` CLI。先通过 `orca skills get orca-cli`／`orchestration` 取得与运行版本一致的指引，再操作。CLI 能完成的优先用 CLI；插件设置、原生面板操作使用 `orca computer`。
- 原生搜索入口是 **Search worktrees and browser tabs / Cmd-J**。初始化要选中精确的 **Team Orchestrator: Initialise local adapter** 命令，再做 **Test connection**。
- macOS 的 Orca 与辅助程序权限已经配置过。不要让用户无依据地反复授权或重启；截图／输入失败时先区分屏幕锁定、焦点、窗口变化和真实权限错误。
- 11／21 人层级可能需要原生 Nested worker depth 2；不自行修改全局深度或绕过宿主限制。

## Suggested skills

下一 agent 应在 Skill 工具可用时调用相应技能；若只提供文件工具，读取准确的 `SKILL.md` 并遵循其要求。

- **implement-spec**：继续 #106 的票据图、实现／合并流程；之前位于 `~/.codex/skills/implement-spec/SKILL.md`，若目录不在可用目录表中先查找。
- **orchestration**：监督真实 Orca 团队与 CLI 操作；入口 `~/.agents/skills/orchestration/SKILL.md`，实际操作指南通过本机 `orca skills get ...` 加载。
- **tdd**：后续发现业务缺陷并修改源码时使用既有公共测试边界。之前位于 `~/.codex/.tmp/marketplaces/mattpocock/skills/engineering/tdd/SKILL.md`。
- **code-review**：修改完成后进行独立 Spec／Standards 两轴审查。之前位于同一 engineering 目录的 `code-review/SKILL.md`。
- **handoff**：再次交接时更新上下文；本次按用户指定目录保存，用户目录要求优先于技能默认临时目录。

下一轮推荐：先核对 #120 最新状态和现有实现，处理实际 Codex 启动提示，再执行一组小规模、可清理的增员验收；发现缺陷则修复、审查、重跑，最终按用户的单一发布 agent 规则统一打包。
