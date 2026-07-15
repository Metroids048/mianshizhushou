# 功能回归防护规则（Feature Regression Guard）

> **目的**：防止 AI Agent 修改代码时误删已有功能。每次跨文件变更前必须对照此清单。
> **触发时机**：修改 `App.tsx`、`live.tsx`、`interviewEngine.ts`、`types.ts`、`router.ts`、`orchestrator.ts` 或任何涉及 2+ 文件的变更前。
> **最后更新**：2026-06-24，基于 `src/` + `server/` 源码梳理

---

## 一、受保护功能清单

### A 级保护（P0 — 删除即产品不可用）

| # | 功能点 | 文件 | 关键代码指纹 |
|---|-------|------|------------|
| A1 | 首页 JD 输入与保存 | `home.tsx`, `App.tsx:createOrUpdatePosition` | `upsertPositionIntakeOnServer` |
| A2 | 路由解析（27 条路由全部可用） | `router.ts` | `export function parseRoute` → `AppRoute` |
| A3 | 实时助手提词卡自动生成 | `live.tsx` | `streamCueCardFromServer` + `normalizeCard(generateCueCard(` |
| A4 | 模拟面试多轮问答 | `live.tsx:InterviewRoomView`, `server/index.ts` | `POST /api/mock/session` + `/mock/session/:id/answer` |
| A5 | 面试报告生成（5 维度） | `interviewEngine.ts:buildInterviewReport` | `completeness.*relevance.*evidenceStrength.*structure.*riskControl` |
| A6 | App 壳导航（侧栏 + 移动端） | `appShell.tsx` | `PRIMARY_NAV` 常量 + `useMobileNav` |
| A7 | SSE 流式提词卡 | `server/index.ts:copilot/cue-card/stream` | `text/event-stream` + `send("card", result)` |
| A8 | 后端降级机制 | `live.tsx`, `coach.ts`, `server/orchestrator.ts` | `backendStatus: "fallback"` + `generateHighlightsLocal` |

### B 级保护（P1 — 删除影响核心路径）

| # | 功能点 | 文件 |
|---|-------|------|
| B1 | 用户认证（登录/注册/JWT） | `auth/AuthPage.tsx`, `server/domains/auth/` |
| B2 | 游客模式 + 数据合并 | `auth.ts:useAuth`, `POST /api/auth/merge-guest` |
| B3 | 简历文件导入（txt/md/pdf/docx） | `resumeImport.ts` |
| B4 | 简历 AI 优化（section/full/match） | `resume.tsx`, `POST /api/copilot/resume/ai` |
| B5 | JD AI 解析 | `jd.tsx`, `POST /api/positions/analyze` |
| B6 | 资料库（项目资料 + 问题笔记） | `questions.tsx` |
| B7 | 对话完善（ConversationSession） | `conversation.tsx`, `App.tsx:toConversationSessionFromPosition` |
| B8 | 面试记录列表 + 报告详情 | `records.tsx` |
| B9 | 新用户 Onboarding | `onboarding/OnboardingPage.tsx` |
| B10 | 模拟面试配置页 | `mock-setup.tsx` |
| B11 | 语音识别（Web Speech API） | `speech.ts`, `live.tsx` (interim/final/editable) |
| B12 | 提词卡重构（基于反馈） | `POST /api/copilot/cue-card/reconstruct` |

### C 级保护（P2 — 删除影响体验完整性）

| # | 功能点 | 文件 |
|---|-------|------|
| C1 | 账户管理弹窗（导入/导出/重命名/清除） | `records.tsx:AccountModal` |
| C2 | 反馈弹窗 | `App.tsx:GlobalFeedbackForm` |
| C3 | 法律条款页 | `legal/LegalPage.tsx` |
| C4 | 404/500 页面 | `system/StatusPages.tsx` |
| C5 | SEO 组件 | `system/Seo.tsx` |
| C6 | 移动端适配（<760px） | `appShell.tsx:useMobileNav` |
| C7 | 配额系统 | `server/domains/quota/` |
| C8 | 语音指标统计 | `speechAnalysis.ts`, `live.tsx:SpeechMetrics` |
| C9 | RAG 文档检索 | `server/rag.ts`, `document_chunks_fts` |
| C10 | 数据导入/导出 | `POST /api/data/export`, AccountModal |

---

## 二、文件依赖拓扑

修改以下文件时，必须同时检查依赖它的文件：

| 被修改文件 | 必须检查的依赖文件 |
|-----------|------------------|
| `src/types.ts` | **所有** `.tsx` / `.ts`（全局类型） |
| `src/lib/router.ts` | `App.tsx`（27 条路由匹配） |
| `src/lib/interviewEngine.ts` | `App.tsx`, `live.tsx`, `records.tsx` |
| `src/lib/apiClient.ts` | `App.tsx`, `live.tsx`, `resume.tsx`, `home.tsx` |
| `src/lib/store.ts` | `App.tsx`, `home.tsx`, `resume.tsx` |
| `src/lib/auth.ts` | `App.tsx`, 所有受 auth 保护的页面 |
| `src/components/appShell.tsx` | `App.tsx`（唯一消费者，影响所有页面导航） |
| `src/components/shared.tsx` | 几乎所有组件 |
| `server/orchestrator.ts` | `server/index.ts`（唯一消费者，影响所有 AI API） |
| `server/db.ts` | `server/index.ts`, `server/orchestrator.ts` |

---

## 三、删除前强制检查

Agent 在删除或大幅替换任何代码块前：

```
□ 对照"A 级保护清单"→ 如果涉及 → 立即停止，向用户说明风险并请求明确确认
□ 对照"B 级保护清单"→ 如果涉及 → 警告用户具体受影响功能，请求确认
□ 对照"文件依赖拓扑"→ grep 所有消费者
□ 检查是否在替换 full 实现为 stub 占位（禁止）
□ L2+ 任务填写 change-impact-analysis.md
```

---

## 四、已知避坑案例

### 案例 1：误删提词卡自动生成 useEffect（2026-06-24）

- **文件**：`live.tsx`
- **代码块**：auto-cue-insert useEffect（约 30 行，`streamCueCardFromServer` + `normalizeCard`）
- **影响**：A3 级 P0 功能完全失效
- **预防**：`live.tsx` 中的 useEffect 块删除前必须理解业务用途

### 案例 2：full 实现回退为 stub

- **风险**：`conversation.tsx`(13.7KB full) 被替换为 `conversation-stub.tsx`(561B 占位)
- **预防**：禁止将 full 替换为 stub；部署脚本 `deploy-full-phase*.ps1` 明确复制 full → 目标
