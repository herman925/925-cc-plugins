# #137：0.1.18 模型目录验证

验证日期：2026-10-18。环境：macOS arm64、真实 Orca 1.4.229（固定源码 `37c314bcc96063c42c468e564df2c34bac8ef8a1`）、Electron 43.7.8、Node 24.21.0。

当前项目的真实插件已加载 **0.1.18**，New team 的 Model 下拉框包含 **Codex 7 个型号、Claude Code 4 个选项**，另保留 Default。切换 CLI 和选择模型后，effort 跟随其原生列表变化。没有启动真实团队或发送模型生成任务。

脱敏结果及构建 SHA-256 见 [model-catalog-137.receipts.json](model-catalog-137.receipts.json)。记录不含运行时凭据、账户目录、会话 transcript 或完整 settings。

## 真实结果

| CLI | 真实下拉框 ID | 显示名称 |
| --- | --- | --- |
| Codex | `gpt-6.1-sol` | GPT-6.1-Sol |
| Codex | `gpt-6-astra` | GPT-6-Astra |
| Codex | `gpt-6-sol` | GPT-6-Sol |
| Codex | `gpt-6-luna` | GPT-6-Luna |
| Codex | `gpt-5.6-sol` | GPT-5.6-Sol |
| Codex | `gpt-5.6-terra` | GPT-5.6-Terra |
| Codex | `gpt-5.6-luna` | GPT-5.6-Luna |
| Claude Code | `opus` | deepseek-v4-pro |
| Claude Code | `fable` | Fable |
| Claude Code | `sonnet` | deepseek-flash |
| Claude Code | `haiku` | deepseek-flash |

Claude 的名称来自本机实际配置。插件在内部保留 CLI 接受的别名 ID；根据用户随后确认的显示要求，选项只显示 `deepseek-v4-pro` 等名称，去掉原先括号中的 `opus` 等 ID。初始回执保留当时的显示文本，后续显示调整另作记录。两类目录的原生来源均为 `probe`。这些是 CLI 列举的选项，不等于每项已通过生成请求验证或实际正在运行。

真实面板使用原有 sandbox iframe 和原生 panel broker，验证了：

- Head 的 Codex 模型下拉含 7 个具体型号，选择 `gpt-6-astra` 后可以选择 `high`。
- 将 Workers CLI 切换至 Claude Code 后出现独立的 4 项列表，选择 `fable` 后可以选择 `max`。
- Astra 的 effort 包含 low、medium、high、xhigh、max、ultra；Fable 不出现 ultra。
- 验证后将 Head 恢复 Default、Workers 恢复 Codex／Default；没有点击 Launch team。
- 初始验证项目 `925-cc-plugins` 的普通终端仍为原有 Codex、Claude Code 两个，没有新增临时 Chat 或团队成员。

最终面板跟随桌面实际选择显示 `Project: Outreach`，在该面板再次刷新并验证两类列表。JSON 分别标明直接原生读取的初始项目与最终可见面板项目；没有把插件强制导航回 CLI 的工作目录，也没有将两个项目的身份当作同一个 scope。

## 根因和实现

最初同一真实宿主的 session-less `agentSession.modelCatalog` 对两种 CLI 均返回 `runtime_error / structured_agent_session_unsupported`。固定源码的对应路径要求已有 structured host，其缺省拒绝原因为 `hostDisabled`。普通终端已打开不保证该服务已初始化。

随后调用现有只读 `agentSession.restartResumable({})`，返回 0 个恢复 offer、0 个失败 offer；再读目录即可获得 Codex 7 项、Claude Code 4 项。该接口在源码中先安装 host，然后只调用 `restartResume.list` 和 `listFailures`，不调用 continue、dismiss 或 create。

插件复用这个受支持的读取路径：先确认真实项目 session，再读目录；仅在宿主返回上述 structured unsupported 拒绝时尝试一次只读初始化并重读。正常已就绪路径不反复读取恢复 offer。没有添加隐藏会话，没有修改原生 Chat 设置或 Orca 安装文件，也没有独立复制一套账户解析和 CLI 探测实现。

为新团队读取目录时故意不传已有 Chat 的 sessionId。Orca 因而使用当前将启动的账户／配置分别列举各 CLI，避免从旧会话固定账户借用列表。普通 terminal handle、provider 对话 ID 和 structured sessionId 始终没有互换。

普通终端准备检查同时核对项目、执行主机、连接、非 orphan、实例和 `terminal.agentStatus.isRunningAgent`。CLI 已退出但 shell 尚在时不能靠旧 launch identity 通关。working、permission 和 idle 均不要求打断或重新打开空闲会话。为控制原生读取额度，单次最多核对四个候选；尚不能确认的情况保持 unknown，不声称没有会话。

有有效 session 才取得目录；没有 session 时新队创建和启动均受阻，不能使用 Default 绕过。保存到启动之间关闭 session，也会在启动准入前拒绝，不预留或新建成员。原有团队和已完成回执仍按原身份／去重契约兼容。

面板可见时约每 30 秒重读，另保留 Refresh models、项目切换刷新和启动准入读取。目录缓存、账户隔离和 provider probe 由 Orca 管理；刷新不承诺强制联网。CLI 返回的模型与实际已生效模型仍是不同事实。

模型发现不再读取表单没有使用的 structured create-support／context capability，也不重复执行本机安装 preflight；本机目录探测本身使用原生启动 resolver，CLI 缺失采用其原生 unavailable 事实。SSH 仍使用远端 preflight。冷目录初始化、保存、首位启动及结果读取已加入 30 次原生 panel admission 额度回归。

## 验证范围

| 检查 | 结果与边界 |
| --- | --- |
| 构建 | 0.1.18 的 `main.mjs`、`runtime-adapter.cjs`、`panel.html` 已生成 |
| Domain／bridge | 574 项通过；包括单一 CLI、忙碌、无 session、CLI 退出、关闭、错项目／host、orphan、structured tab、未知目录、冷／热目录 30-call 额度和启动前关闭会话 |
| 浏览器 | 完整 27 项通过；最后调整后再次核对模型列表、重试、远端限制及无 session 提示 |
| Host contract | Orca 1.4.222／1.4.223／1.4.229 三个固定源码通过；执行其原生只读 offer handler，确认 install → list → listFailures，无恢复效果 |
| 独立 Electron | 四组 synthetic Orca 版本元数据下的真实 Electron IPC fixture 通过；这是 transport／ownership／consent 回归，不是四台宿主的模型或 provider 验收 |
| 真实目录 | 原有两个普通终端、两个 provider 的目录读取及新版插件模型／effort 下拉验证通过 |

复现命令沿用 README：`npm run build`、`npm test`、Playwright 和 `npm run test:host`。独立 Electron 使用专用测试可执行文件，并与真实 Orca inspector 操作错开，避免共用 9229 端口。

## 尚未扩大的实机结论

真实现场同时保留着 Codex、Claude Code 普通终端。只有一种 CLI 已开、无 session、native Chat 等变体在 fixtures 和源码契约中验证，没有为了制造现场关闭用户会话或另建 Chat。

真实冷 host 的只读初始化已在代码修复前实测；最终插件在同一已初始化宿主上完成下拉框实测。没有为了验证插件冷启动重启 Orca，因此“全新 Orca 进程中的完整自动链路”仍不是本次真实证据。

没有通过修改登录凭据制造故障，没有实测全部账户切换／配置变体、Windows 或 SSH 目录。SSH 显式型号仍保持 unknown，不借用本机目录。没有据此关闭 #137 或宣称后续团队协作、规模验收完成。
