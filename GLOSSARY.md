# Orca Team Orchestrator

此詞彙表區分本倉庫的 Orca 原生插件與 Claude Code mod，作為 Lin 發起的開發 spec 使用的共同語言。

## Language

**Orca 原生插件**：安裝在 Orca ADE、由 Orca 提供操作入口與執行環境的擴充功能，其產品行為不綁定某一 agent CLI 或使用者的作業系統。
_Avoid_：Claude Code 插件、Codex 插件（指稱本次開發目標時）

**Claude Code mod**：本倉庫中運行於 Claude Code 會話內的擴充功能；它與 Orca 原生插件是不同產品環境。
_Avoid_：Orca 原生插件（指稱既有會話內 mod 時）

**團隊成員**：在某個團隊中承擔角色與匯報關係的協作者；成員的身份不等同於提供執行能力的 agent 品牌。
_Avoid_：CLI、終端標籤頁（作為成員身份的同義詞）

**Agent**：由 Orca 管理、為團隊成員提供工作能力的 AI 執行工具，例如 Claude Code 或 Codex。
_Avoid_：團隊成員（只在指稱執行工具時）
