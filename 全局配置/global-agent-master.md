---
name: global-agent-master
title: Global Agent Master — SSOT Behavior Rules
description: SSOT for all agent-facing behavior across Cursor, Codex, Claude Code, and Reasonix. Permanent online rules, R2T workflow, skills/tools usage, development and acceptance flow, now with feature deletion gate and cross-agent consistency protocol.
metadata:
  type: project
---

# Global Agent Master

This file is the SSOT for all agent-facing behavior across Cursor, Codex, Claude Code, and Reasonix.

**Why:** 统一所有 agent 端的行为规范，避免不同端执行标准不一致导致的返工。
**How to apply:** 每次编码任务开始前，对照此文件的优先级链和规则执行。

## 1. 永久在线规则

1. Priority order: user instruction > repo AGENTS.md > global master > skills/tools suggestion.
2. Before any implementation work, read the global memory files and the active repo overlay if present.
3. Never claim done without verification evidence.
4. Never use fake success, TODO-as-done, or local fallback as model success.
5. "最大权限" means fewer confirmations for the stated task only, not destructive scope. Scope = stated bug/feature; ask before deleting, uninstalling, or removing config dirs.
6. If uncertainty affects the implementation path, stop and ask.
7. **NEW: 功能删除门禁** — 修改任何文件前，对照 `feature-regression-guard.md` 的受保护功能清单，确认不会误删已有功能。删除 A 级功能代码必须显式告知用户并获得确认。
8. **NEW: P0 错误阻断规则** — 如果任务导致以下 P0 错误，Agent 必须在 claim done 前修复：
   - 页面白屏 / 404 / 500
   - 核心用户路径中断（如 JD 输入 → 保存 → 跳转失败）
   - 路由 404 / 导航失效
   - AI 核心功能（提词卡生成、报告生成）完全无响应

## 2. 对话提问门禁

Ask first when any of the following is true:
- The request is vague, broad, or outcome-only.
- The task touches product direction, IA, UI, AI/data, or multiple layers at once.
- The request is 0→1, new module, new page, or cross-file flow.
- The user has not specified the non-goals, acceptance, or data owner.

Required questions:
- Main change type: product / IA / UI / AI-data.
- Version target: prototype / internal beta / MVP / commercial.
- Out-of-scope list.
- Acceptance path.
- UI page acceptance card when applicable.

## 3. R2T 需求转换

R2T converts the user's request into a task card, not an implementation order.

Minimum task card:
- main change type
- version target
- out-of-scope
- acceptance card
- data owner
- risk notes
- **NEW: affected protected features** — 对照 `feature-regression-guard.md` 列出此次变更可能影响的受保护功能
- **NEW: change impact scope** — 列出估计受影响的文件数及风险等级 (🟢🟡🟠🔴)

R2T output must be shown to the user for confirmation before execution when the task is ambiguous, cross-layer, or 0→1.

## 4. Skills / 工具按需调用

Use skills and tools only after the task card is confirmed.
- Requirement clarification: whenever the request is vague or missing acceptance.
- Zero-to-one gate: any new module, page, or flow that lacks an approved architecture summary.
- Verification: every task completion requires fresh evidence.
- **NEW: Feature regression check** — 跨文件修改前，自动加载 `feature-regression-guard.md` 并对照 A/B 级功能清单。

## 5. 开发流程与验收

1. Clarify → 2. Convert to R2T → 3. Confirm task card → 4. **Execute change impact analysis** (跨文件时) → 5. Execute smallest verifiable change → 6. Self-review → 7. Verify with fresh evidence → 8. Record history/decisions/fact changes.

## 6. 跨端执行一致性协议 (NEW)

当同一任务可能被 Cursor、Codex、Claude Code 或 Reasonix 在不同时间执行时：

1. **统一入口**：所有 Agent 必须从同一份 `AGENTS.md` + PRD + 功能清单开始
2. **统一验收**：所有 Agent 使用相同的 verify 命令（见 `projects-registry.md`）
3. **上下文传递**：任务切换 Agent 时，通过任务卡 + `SESSION.md` 传递当前状态快照
4. **禁止各自为政**：不同 Agent 不得各自维护独立的配置文件，所有配置变更必须回写到全局配置目录
5. **交接清单**：
   - 当前完成了哪些 Phase
   - 当前正在进行的任务及其依赖
   - 已知的待修复问题
   - 本次对话做了哪些变更（含文件列表）

## 7. 返工复盘与持续优化

Classify every rework:
- requirement not locked
- layered change mixed together
- verification missing
- configuration not loaded
- context drift
- **NEW: feature accidentally deleted** — 误删已有功能（根因：未对照功能清单）
- **NEW: cross-agent inconsistency** — 跨端执行不一致（根因：未走统一协议）

If the same failure repeats, update the rule files or task template first, not just the implementation.
