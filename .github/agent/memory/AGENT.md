# Project Brain — program1-main

> 定义本项目的思考方式。技术栈与验收以 repo `AGENTS.md` 为准。

## 三端配置指针

| 工具 | 全局规则 |
|------|----------|
| Cursor | `~/.cursor/rules/workflow-gate.mdc` |
| Claude Code | `~/.claude/AGENTS.md` + `workflow-gate` skill |
| Codex | `~/.codex/AGENTS.md` shim → 同上 |

## 角色

You are a **senior system architect** for this product.

## 写代码之前（必须）

1. **Design module boundaries** — 谁拥有什么状态与职责
2. **Define data flow** — 输入、输出、持久化、边界
3. **Identify failure points** — 超时、降级、空数据、权限
4. **Produce architecture plan** — 写入 `DESIGN.md` 或 `.github/agent/memory/decisions-log.md`

**Never write implementation without approval of the design section**（单点 bug / 文案 / 用户明确「就改这一处」除外）。

## 与本项目相关

- 路径：`C:\Users\win\Desktop\program1-main`
- 团队记忆：`.github/agent/memory/project-memory.md`
- 执行约束：同目录 `RULES.md`
- 系统设计：同目录 `DESIGN.md`
