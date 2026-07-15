# Execution Rules — program1-main

> 与全局 `workflow-gate`、`ai-delivery-anti-patterns` 叠加；冲突时 repo `AGENTS.md` 优先。
> 
> **新增强制加载清单（2026-06-24）**：
> - 跨文件修改前 → 必读 `feature-regression-guard.md`（受保护功能清单）
> - 修改共享类型/工具函数前 → 必执行 `change-impact-analysis.md` 流程
> - 切换 Agent 工具时 → 必走 `全局配置/multi-agent-collaboration.md` 交接协议
> - 任务分级 → 参考 `全局配置/vibe-coding-engineering-standards.md` L0-L4 标准

## 模糊输入 → 必须提问（硬门禁）

以下情况**禁止直接改代码**，须先澄清或输出 Mini-Spec + 待确认：

- 「优化 UI」「对标竞品」「整体改一下」「看着办」但未说明改哪一层
- 同时动产品定位、页面结构、视觉、AI/数据
- 未说明本轮哪些页面/数据/测试不动

**必问清单：** 主改动类型（四选一）· 版本目标（四选一）· 不动清单 · 验收方式 · 页面验收卡（涉及 UI 时）

用户明确「直接做 / 就改这一处」且范围一句话说清 → 可 Tier B 快路径。

## 大改 / 冲突 → 用非技术语言确认（硬门禁）

以下情况必须先问用户，且问题必须通俗：

- 改动会明显改变页面布局、入口位置、用户流程或原有使用习惯
- 改动会影响历史数据、保存位置、记录展示、登录/游客模式、AI fallback 显示方式
- 当前计划和已有实现、已有规则、测试结果或用户之前要求发生冲突
- 为了完成一个目标，需要删除、隐藏、合并或弱化另一个已有能力

提问格式要求：

- 用“你会看到什么变化 / 这会影响什么 / 我建议怎么选”的说法
- 避免只说技术词；如果必须提技术词，要同时翻译成人话影响
- 给出 2-3 个可选方向，并说明每个方向的取舍
- 用户未确认前，不得继续做大范围实现

## 每轮只允许一类主改动

- 产品主线 / IA / UI 视觉 / AI·数据闭环 — **四选一**
- 禁止：改视觉时顺手改 IA；补 AI 时顺手重做首页信息架构

## 硬约束

- Tier A：未过架构/接口 approval 不得 Write/Edit 实现文件
- 改页面必须同步：共享样式、文案、状态逻辑、测试断言
- 必须写数据 owner 与接口契约（见 `DESIGN.md`）
- P5 自检 → P6 verify；无 fresh 证据不得 claim done

## 功能删除门禁（NEW）

修改或删除任何代码块前：
1. 对照 `feature-regression-guard.md` 确认是否涉及 A/B/C 级受保护功能
2. A 级（P0）→ **停止，显式请求用户确认**
3. B 级（P1）→ 警告用户并请求确认
4. 禁止将 `*-full.tsx` 替换为 `*-stub.tsx`

## 产品专属禁止

- 删弱 JD 工作台、问题库等上下文底座
- 提词卡输出完整逐字稿
- 模拟面试做成纯文本表单（须语音/追问体验）
- local fallback 伪装模型成功
- 启动脚本必须可以自动打开系统 Chrome / Edge；不得使用 Codex in-app Browser/IAB 自动打开

## 验证

- 先 E2E 用户故事（见 `project-memory.md` 7 步）
- 再 `AGENTS.md` UI/语音闸口
- 再 `npm run verify`
- **NEW: 跨文件修改后 → 对照 `feature-regression-guard.md` 抽查 3 个 A 级功能**
