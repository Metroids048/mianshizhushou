---
name: user-memory-global
title: User Memory — Global Preferences & Workflow
description: Cross-project user preferences, global workflow, lessons learned, and retrospective rules. Read before any coding task.
metadata:
  type: user
---

# User Memory (Global)

> Cross-project facts, preferences, and workflow conventions.

## Preferences

- Reply language: 简体中文 (unless user asks otherwise)
- Skills: global library at `~/.cursor/skills/`; match by description, Read full SKILL.md when applicable
- Token habits: short updates, no long log dumps; never skip verification to save tokens
- Tools: Cursor + Claude Code + Codex share hooks via `~/.ai-workspace/scripts/`
- **0→1 mode: strict** — 新模块/大范围「帮我做…」必须先方案+ADR+用户确认，再写代码；用户非技术，由 Agent 主动补 ADR/模块边界
- **Maximum permission:** 「最大权限」「全部解决」= 少来回确认、把**当前问题**修完 — **不等于**可删 CC Switch、清配置目录、跑卸载脚本；破坏性操作须先说明并获确认

## Global Workflow

1. SessionStart: Read `global-session-core` skill + this file before coding tasks
2. Coding tasks: ai-coding-ok PDCA — global memory first, project overlay if present
3. **0→1 chain (strict):** `zero-to-one-gate` → `brainstorming` → user approve → `writing-plans` or `planning-with-files-zh` → build → `global-delivery-gate`
4. Before claiming done: run detected verify commands (see `global-delivery-gate` skill)
5. After tasks: append `global-task-history.md` with `[project: path]` tag

## Retrospective rules (Read on product/UI/AI tasks)

- 输入模糊（优化一下/改 UI/对标竞品/整体弄好）→ **必须提问**锁定主改动类型、版本目标、不动清单、验收方式；禁止脑补后直接改代码
- 每轮**只选一个**主改动类型：产品主线 / IA / UI / AI·数据 — 禁止混改
- 改页必须同步：共享样式、文案、状态、测试
- 验收：完整用户故事先于单页截图；verify 通过才可 claim done

## Lessons Learned (cross-project)

- Skills hooks must use `scan-global-skills.ps1`, not full catalog dump (saves tokens)
- JSON settings for RTK must be UTF-8 **without BOM**
- Vibe coding「帮我做一个…」= 0→1 until proven otherwise — do not skip architecture for speed
- **2026-06-03:** Agent 误删 CC Switch 配置（用户未授权）— 「最大权限」仅图省事，禁止越权破坏性操作
- **2026-06-17 三端避坑（TASK-072）：** `windows-agent-shell.mdc` + `repair-tri-end-hooks.ps1` + `CLAUDE_CODE_ATTRIBUTION_HEADER=0`
- **2026-06-17 交付门禁（TASK-073）：** Agent Platform 用 `verify-all`；`program1-main`/`demo1` 用 `npm run verify`；勿在平台根跑 `npm run lint`
- **2026-06-17 DeepSeek 缓存二期：** 客户端 `15721` → CC Switch → `18789` `deepseek-cc-proxy`；playbook：`Agent Platform/docs/tri-end-deepseek-cache-playbook-zh.md`
- **2026-06-18 AI 项目复盘（program1-main）：** 未锁「本轮改哪一层」就改页面 → 返工恶性循环；模糊输入必须提问，禁止跨层混改
