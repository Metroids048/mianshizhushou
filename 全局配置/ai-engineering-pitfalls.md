---
name: ai-engineering-pitfalls
title: AI Engineering Pitfalls — 避坑手册
description: Cross-project AI engineering pitfalls: CC Switch deletion, tri-end sync, delivery gate differences, DeepSeek cache architecture, program1-main rework lessons, NEW: feature deletion incident and multi-agent inconsistency.
metadata:
  type: project
---

# AI Engineering Pitfalls — Cross-Project Lessons

**Why:** 记录三端 (Cursor/Codex/Claude Code) + Reasonix 开发中出现的严重返工事件和避坑策略，防止重复踩坑。
**How to apply:** 每次涉及配置修改、三端同步、0→1 开发、跨层改动、代码删除前，对照此清单检查。

---

## 1. 2026-06-03: Agent 误删 CC Switch 配置

**事件:** Agent 在「最大权限」模式下删除了 `~/.cc-switch` 配置目录，用户未授权此操作。

**教训:**
- 「最大权限」「全部解决」= 少确认，把当前问题修完 — **≠ 可删配置/跑卸载脚本**
- 破坏性操作（`Remove-Item -Recurse`、卸载、删配置目录）必须**先说明并获确认**
- 已沉淀为 `maximum-permission-scope.mdc` 规则 + ADR-G003

**检查点:** 在提议任何涉及 `~/.cc-switch`、cc-sync、cc-watch、OAuth sessions、其他 provider 的删除/禁用操作前，必须显式询问。

---

## 2. 2026-06-17: 三端配置避坑 (TASK-072)

**问题:** Cursor/Codex/Claude Code 三端因 Windows Shell 编码和 Claude Code attribution header 不一致导致行为差异。

**修复:**
- 添加 `windows-agent-shell.mdc` 规则
- 运行 `repair-tri-end-hooks.ps1` 统一三端 hook 配置
- 设置 `CLAUDE_CODE_ATTRIBUTION_HEADER=0` 环境变量

**检查点:** 配置修改后运行 `verify-tri-end-config.ps1` 验证三端一致性。

---

## 3. 2026-06-17: 交付门禁差异 (TASK-073)

**问题:** 不同项目使用不同的 verify 命令，Agent 在错误位置运行了 `npm run lint`。

**正确 verify 命令:**
- Agent Platform → `node prototype/scripts/verify-all.js`（使用 `ai-delivery-gate` skill）
- program1-main → `npm run verify`
- demo1 → `npm run verify`
- **禁止**在 Agent Platform 根目录跑 `npm run lint`

**检查点:** 执行 verify 前，先根据 `projects-registry` 确认当前项目的正确 verify 命令。

---

## 4. 2026-06-17: DeepSeek 缓存二期架构

**架构链路:**
```
客户端 (15721) → CC Switch → deepseek-cc-proxy (18789)
```
deepseek-cc-proxy 负责 tool 排序 + 剥离 header。

**Playbook 位置:** `Agent Platform/docs/tri-end-deepseek-cache-playbook-zh.md`

**检查点:** 修改 CC Switch 或 proxy 配置时，参考此 playbook 确保三端兼容。

---

## 5. 2026-06-18: AI 项目复盘 — program1-main 返工恶性循环

**事件:** 未锁定「本轮改哪一层」就改页面 → 产品/IA/UI 混改 → 持续返工。

**根因分类:**
- requirement not locked（需求未锁定）
- layered change mixed together（跨层混改）
- verification missing（缺失验证）
- configuration not loaded（配置未加载）
- context drift（上下文漂移）

**强制规则（已沉淀为 `ai-project-retrospective-rules-zh.md` + `ai-delivery-anti-patterns.mdc` + ADR-G004）:**
- 模糊输入（优化一下/改 UI/对标竞品/整体弄好）→ **必须提问**，锁定主改动类型、版本目标、不动清单、验收方式
- 每轮**只选一个**主改动类型：产品主线 / IA / UI / AI·数据 — 禁止混改
- 禁止脑补后直接改代码

**检查点:** 收到模糊需求时，先执行提问门禁（见 [[coding-conventions]]），不通过不写代码。

---

## 6. NEW: 2026-06-24: Agent 误删提词卡自动生成功能

**事件:** Agent 在修改 `live.tsx` 时移除了 auto-cue-insert useEffect 代码块（约 30 行），导致实时助手的提词卡自动生成功能完全失效。该功能是 A5 级（P0）受保护功能。

**根因:**
- Agent 不理解业务代码块的用途（将核心功能逻辑误判为无用副作用）
- 缺少功能清单对照检查机制
- 通过精确补丁脚本（`patch-live-auto.ps1`）添加的代码块容易被批量修改时误删

**教训:**
- 任何 `useEffect` 块的删除必须先理解其业务用途
- 修改 `live.tsx` 时必须对照 `feature-regression-guard.md` 确认 A5 功能未被触及
- 补丁脚本添加的代码块应添加注释标记其重要性

**已落地规则:** `feature-regression-guard.md` — 受保护功能清单 + 删除前强制检查
**约束文件:** `global-workspace/auto-cue-insert.txt`（代码块备份）

---

## 7. NEW: 2026-06-24: 全局配置缺失导致多 Agent 行为不一致

**事件:** Cursor/Codex/Claude Code/Reasonix 四端在执行同一项目任务时，因缺少统一的全局约束配置，导致：
- 不同 Agent 对"完成"的定义不一致（有的跳过验证，有的做完整回归）
- 功能删除没有统一的门禁检查
- 项目上下文（PRD、功能清单）未在所有 Agent 会话中自动加载

**修复:**
- 创建 `prd-ai-job-interview-platform.md` — 项目 SSOT 需求文档
- 创建 `feature-regression-guard.md` — 受保护功能清单
- 创建 `change-impact-analysis.md` — 变更影响分析模板
- 创建 `multi-agent-collaboration.md` — 四端协作协议
- 增强 `global-agent-master.md` / `coding-conventions.md` / `ai-engineering-pitfalls.md`

**检查点:** 每次开启新 Agent 会话时，确认已加载 PRD + 功能清单 + 协作协议。

---

## 快速检查清单

- [ ] 提议删除/禁用配置？→ 先确认
- [ ] 修改三端配置？→ 跑 `verify-tri-end-config.ps1`
- [ ] 执行 verify？→ 查 `projects-registry` 确认正确命令
- [ ] 改 CC Switch/proxy？→ 参考 DeepSeek playbook
- [ ] 模糊需求？→ 提问门禁，锁定改动层，禁止跨层混改
- [ ] **NEW: 删除任何代码块？→ 对照 `feature-regression-guard.md` 功能清单**
- [ ] **NEW: 跨文件修改？→ 填写 `change-impact-analysis.md` 模板**
- [ ] **NEW: 新 Agent 会话？→ 确认已加载 PRD + 全局约束**
