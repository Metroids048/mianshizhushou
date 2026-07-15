---
name: coding-conventions
title: Coding Conventions — Actionable Rules
description: Actionable coding rules: SessionStart protocol, zero-to-one gate, question gate, delivery gate, max permission scope, R2T, verification checklist. Now with Feature Deletion Gate & Change Impact Analysis.
metadata:
  type: project
---

# Coding Conventions — Actionable Rules for Every Task

**Why:** 统一 Cursor / Codex / Claude Code / Reasonix 四端的行为标准，避免跨端执行不一致导致的返工。
**How to apply:** 每次编码任务开始前自动加载，对照检查清单执行。

## SessionStart Protocol

Before any coding task:
1. Read user-memory-global memory (this env) or `~/.ai-workspace/memory/user-memory.md` (file)
2. Read `global-session-core` skill — skill routing, lean tokens, verification-before-completion
3. Check `projects-registry` for project-specific verify command
4. Read project `AGENTS.md` if present (overrides global rules for that repo)
5. **NEW: Read `feature-regression-guard.md`** — 对照受保护功能清单，确认本次任务不会误删已有功能
6. **NEW: If cross-file change → Read `change-impact-analysis.md`** — 评估变更波及范围

## Zero-to-One Gate (STRICT — must trigger before any Write/Edit on new work)

Triggers: 新模块、新页面、「帮我做…」、无 ADR 覆盖、跨文件流程
If triggered:
1. Read `zero-to-one-gate` + `brainstorming` skills
2. Present 2–3 approaches; get user approval
3. Write ADR or `docs/architecture/` summary
4. **Do not** scaffold or implement until approved — even if user says「直接做」
5. Then: `writing-plans` or `planning-with-files-zh` → build → `global-delivery-gate`

## Question Gate (must ask before coding when):

- Request is vague/broad/outcome-only ("优化一下", "改 UI", "对标竞品", "整体弄好")
- Task touches product + IA + UI + AI/data or multiple layers at once
- 0→1, new module, new page, or cross-file flow
- User hasn't specified non-goals, acceptance, or data owner

Required questions: main change type / version target / out-of-scope / acceptance path

## Feature Deletion Gate (NEW — STRICT)

Before deleting or substantially replacing any code block (function, useEffect, component, route):
1. Check `feature-regression-guard.md` — is this code part of an A/B/C-level protected feature?
2. If A-level (P0) → **STOP. Ask user explicitly.** Do not proceed without confirmation.
3. If B-level (P1) → Warn user which feature will be affected, request confirmation.
4. If C-level (P2) → Log the deletion in task history.
5. Run `grep` on the function/export name to find all consumers before deletion.
6. **Never** replace a `*-full.tsx` with a `*-stub.tsx` — stub files are placeholders for incomplete phases.

## Change Impact Analysis (NEW)

When modifying 2+ files or changing shared types/utils:
1. Fill in the `change-impact-analysis.md` template (at minimum: affected files, risk level, protected features check)
2. Map file dependencies: what imports the changed exports?
3. Assign a risk level: 🟢 low / 🟡 medium / 🟠 high / 🔴 critical
4. For 🔴 changes: full regression test on all A/B-level features before claiming done

## Delivery Gate (before claiming done)

1. Re-read the user request and acceptance criteria
2. Follow `global-delivery-gate` skill — auto-detect verify command
3. Capture **fresh command output** as evidence — no assumed PASS
4. If verification was skipped → state **"Task is NOT fully verified."**
5. **NEW: Feature regression self-check** — Spot-check 3 random A-level features to confirm they still work.

Project-specific verify commands:
- Agent Platform: `node prototype/scripts/verify-all.js`
- program1-main / demo1: `npm run verify`
- Do NOT run `npm run lint` at platform root

## Maximum Permission Scope

When user says 「最大权限」「全部解决」「你看着办」:
- **Means:** fewer confirmations to fix the stated problem — NOT permission to expand scope or run destructive cleanup
- **Ask first** before: deleting/uninstalling tools or config dirs, `Remove-Item -Recurse`, removal scripts, disabling auto-sync, wiping registry
- **Protected:** `~/.cc-switch`, cc-sync/cc-watch, OAuth sessions, unrelated providers
- **Default:** minimal diff only

## R2T — Request to Task Card

Vague/broad requests → convert to task card before execution:
1. Main change type (产品主线 / IA / UI / AI·数据)
2. Version target (prototype / internal beta / MVP / commercial)
3. Out-of-scope list
4. Acceptance path (how to verify)
5. Data owner
6. Risk notes
7. **NEW: Affected protected features** (from feature-regression-guard.md)
8. **NEW: Estimated change impact** (file count + risk level)

**每轮只选一个主改动类型** — 禁止跨层混改 (e.g. IA + UI in same round).

## Verification Checklist (per task)

- [ ] Re-read user request + acceptance criteria
- [ ] Run project-specific verify command with fresh output
- [ ] Never claim PASS from cache or assumption
- [ ] If failing: fix → re-verify → only then claim done
- [ ] Record in task history with `[project: path]` tag
- [ ] **NEW: Spot-check 3 A-level protected features** — quick manual walk-through
- [ ] **NEW: Confirm no protected code was deleted** — diff check against feature manifest

## Language
- Reply in 简体中文 unless user explicitly switches to another language
- Keep code, identifiers, file paths, CLI commands in original form
