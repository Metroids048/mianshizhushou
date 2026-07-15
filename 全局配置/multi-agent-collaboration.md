# 多 Agent 协作协议（Multi-Agent Collaboration Protocol）

> **目的**：当同一项目由 Cursor、Codex、Claude Code、Reasonix 多个 AI Agent 工具协作开发时，确保行为一致性、上下文连贯、验收标准统一。
> **适用场景**：跨端开发、任务交接、配置同步、功能回归验证。
> **最后更新**：2026-06-24

---

## 一、四端角色与能力矩阵

| 工具 | 主要用途 | 配置文件位置 | 记忆体系 | 验证命令 |
|------|---------|------------|---------|---------|
| **Cursor** | 编辑器内编码、规则/技能最完善 | `.cursor/rules/*.mdc` | 全局 rules + 项目 `.cursorrules` | 通过 Terminal 运行 |
| **Codex** | 独立编码 Agent | `~/.codex/AGENTS.md` + `config.toml` | `~/.ai-workspace/memory/` | 通过 Shell 运行 |
| **Claude Code** | 独立编码 Agent | `~/.claude/AGENTS.md` + `CLAUDE.md` shim | `~/.ai-workspace/memory/` | 通过 Bash 工具运行 |
| **Reasonix** | 编码 Agent（本工具） | Reasonix memory 体系 + `config.toml` | `memory/` 目录 | 通过 Bash 工具运行 |

---

## 二、统一上下文注入协议

### 2.1 每次会话开始时的必读清单

所有 Agent 在新会话开始时，**必须**按序加载以下文件：

```
1. 全局行为规范
   ├── ~/.ai-workspace/memory/global-agent-master.md      (或 Reasonix: memory/global-agent-master)
   ├── ~/.ai-workspace/memory/coding-conventions.md        (或 Reasonix: memory/coding-conventions)
   └── ~/.ai-workspace/memory/ai-engineering-pitfalls.md   (或 Reasonix: memory/ai-engineering-pitfalls)

2. 项目上下文
   ├── <项目根>/AGENTS.md                                   (项目级覆盖)
   ├── ~/.ai-workspace/docs/prd-ai-job-interview-platform.md (PRD SSOT)
   └── <项目根>/.github/agent/memory/project-memory.md      (项目记忆)

3. 防护规则
   ├── ~/.ai-workspace/memory/feature-regression-guard.md   (受保护功能清单)
   └── ~/.ai-workspace/memory/change-impact-analysis.md     (变更影响分析)
```

### 2.2 统一任务卡格式

无论使用哪个 Agent，任务开始时使用**同一格式**的任务卡：

```markdown
# 任务卡 v1.0

## 任务信息
- **任务编号**：TASK-XXX
- **执行 Agent**：Cursor / Codex / Claude Code / Reasonix
- **主改动类型**：产品主线 / IA / UI / AI·数据（单选）
- **版本目标**：原型 / 内测 / MVP / 商用版
- **风险等级**：🟢低 / 🟡中 / 🟠高 / 🔴极高

## 现状与约束
- **当前 Phase**：___
- **相关文件**：___
- **本轮不动清单**：___
- **受影响的受保护功能**（对照 feature-regression-guard.md）：___

## 变更影响预估
- **修改文件数**：___
- **依赖消费者数**：___
- **是否需要更新 types.ts**：是 / 否

## 验收卡
- **必须有**：___
- **禁止有**：___
- **验证命令**：___
- **手动走查路径**：___

## 完成记录
- **实际修改文件**：___
- **验证结果**：PASS / FAIL / PARTIAL
- **遗留风险**：___
```

---

## 三、任务交接协议

### 3.1 交接时机

以下情况需要执行任务交接：
- 同一任务从 Agent A 切换到 Agent B
- 用户说"用 Cursor 继续做刚才 Codex 没做完的"
- 上一个 Agent 的会话结束但任务未完成

### 3.2 交接清单

交出的 Agent 必须在会话结束前，将以下信息写入 `SESSION.md` 或项目记忆：

```markdown
## 交接快照 — [日期] [Agent名] → [下一个Agent名]

### 当前进度
- 完成了哪些 Phase：___
- 当前正在做的子任务：___
- 阻塞项：___

### 文件变更摘要
| 文件 | 操作 | 简述 |
|------|------|------|
| X.tsx | 修改 | 增加了 Y 功能 |

### 待修复问题
- [ ] Bug-1: ___
- [ ] Bug-2: ___

### 关键上下文
- 上次 verify 结果：___
- 当前路由状态：___
- 特殊注意事项：___
```

### 3.3 接手检查

接手的 Agent 在新会话中必须：
1. 读取 `SESSION.md` 获取交接快照
2. 运行 `npm run verify` 确认当前代码状态
3. 手动走查上次任务涉及的关键路径
4. 对照功能清单确认无功能丢失

---

## 四、配置同步规范

### 4.1 单一真相源原则

以下配置**只在一个地方维护**，其他位置通过引用/脚本同步：

| 配置内容 | SSOT 位置 | 同步方式 |
|---------|----------|---------|
| 全局行为规则 | `~/.ai-workspace/memory/global-agent-master.md` | Reasonix memory 自动同步 |
| 项目规则覆盖 | `<项目>/AGENTS.md` | 各 Agent 手动读取 |
| PRD / 功能清单 | `~/.ai-workspace/docs/` | 所有 Agent 读取同一份 |
| 验证命令 | `~/.ai-workspace/memory/projects-registry.md` | 所有 Agent 读取同一份 |
| Skills 路由 | `~/.ai-workspace/skills-curated/` | `sync-ai-guardrails.ps1` 同步到各端 |
| MCP 配置 | 各工具自己的配置文件 | 手动维护（不共享） |

### 4.2 禁止行为

- ❌ 在 Cursor rules 中写了一套规则，又在 Claude Code 的 CLAUDE.md 中写了不同版本
- ❌ 修改了 PRD 但只更新了一个 Agent 的上下文
- ❌ 在某个 Agent 的会话中"口头约定"了规范但没有回写到全局配置
- ❌ 不同 Agent 使用不同的 verify 命令

---

## 五、跨端功能回归流程

### 5.1 触发条件

当以下情况发生时，必须在**至少两个不同的 Agent 工具**上验证：

- 新增/修改了全局配置文件（AGENTS.md、PRD、memory 文件）
- 修改了路由（router.ts）
- 修改了核心类型定义（types.ts）
- 新增/删除了页面级组件

### 5.2 回归步骤

```
1. Agent A 完成变更 + 自验证
2. Agent A 更新 SESSION.md 交接快照
3. 用户切换到 Agent B
4. Agent B 读取交接快照 + 运行 verify
5. Agent B 手动走查受影响的关键路径
6. Agent B 记录回归结果到 SESSION.md
```

---

## 六、冲突解决

### 6.1 配置冲突

当两个 Agent 对同一配置做了不同修改时：
1. 以**最后写入** `~/.ai-workspace/` 全局配置目录的版本为准
2. 如有疑问，以 PRD 文档中的定义为准
3. 如果 PRD 也无定义，需人工决策后更新 PRD

### 6.2 代码冲突

当两个 Agent 修改了同一文件的不同部分：
1. Agent 必须先 `git pull` 获取最新版本
2. 如有冲突，保留两个变更并标记，由用户决策
3. 严禁 Agent 在未确认的情况下覆盖另一个 Agent 的代码

---

## 七、实际操作建议

1. **会话命名规范**：包含项目名 + 任务简述，方便后续通过 `list_sessions` 查找
2. **优先使用最新 Agent**：如果一个 Agent 反复出错，立即切换到另一个 Agent 重试，并记录原因
3. **任务尽量单端完成**：除非任务量超过单会话限制，否则不主动切换 Agent
4. **配置变更优先**：修改全局配置（rules/memory）时，优先用 Reasonix 的 `remember` 工具以确保跨会话持久化
