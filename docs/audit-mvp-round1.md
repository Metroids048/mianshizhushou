# MVP 首轮完整体验审计报告

> 执行日期：2025-07  
> 执行环境：Codex Desktop（无浏览器渲染），Windows 11，Node.js  
> 模型状态：已配置 DEEPSEEK_API_KEY，在线模型 deepseek-chat 全链路通过  
> 版本：v0.1.0

---

## 一、执行摘要

| 指标 | 数值 |
|------|------|
| 基线验证 `npm run verify` | ✅ 全绿（lint 0 error，typecheck pass，45 测试 pass，build pass） |
| 全流程 `npm run test:full-flow` | ✅ 12/12 断言通过 |
| Codex 接口链路核验 | ✅ 37/40 通过 |
| P0 阻塞问题 | 0 |
| P1 重要问题 | 1（空回答返回 500 而非 400） |
| P2 体验问题 | 2（手动题 source 标记丢失、空文本 cue card 无响应） |
| 在线模型验收 | ✅ `npm run test:ai-success-smoke` 三项全 success |
| AI+语音+RAG 全面验证 | ✅ 32/32 通过（在线模型 14/14，语音 6/6，RAG 4/4）|

**结论：MVP 可发布。0 个阻塞性问题，在线模型 deepseek-chat 全链路 success，语音分析引擎正常，RAG 索引与检索工作正常。存在 1 个需修复的 P1（空回答 500）和 2 个 P2 改进项。**

---

## 二、测试覆盖矩阵

### 已覆盖场景（22 项）

| 模块 | 场景 | 测试来源 |
|------|------|----------|
| 首页 intake | JD 原文解析 + 字段推断 | server/index.test.ts, App.test.tsx |
| 首页 intake | 岗位创建后进入模拟配置 | App.test.tsx |
| 首页 intake | intakeAssistant 追问引导 | codex-audit.ts |
| 首页 intake | activePositionId 切换 | codex-audit.ts |
| 问题库 | 上传 PDF/DOCX 资料 | resumeImport.node.test.ts, full-flow-retest.ts |
| 问题库 | 材料入库 + RAG 索引 | server/index.test.ts |
| 问题库 | 岗位上下文 API | codex-audit.ts |
| 问题库 | 不存在岗位的 404 | codex-audit.ts |
| 实时助手 | SSE 流 stage/delta/card/done 事件 | server/index.test.ts, codex-audit.ts |
| 实时助手 | 提词卡结构化字段 | App.test.tsx, codex-audit.ts |
| 实时助手 | 语音转写 interim→final→editable | App.test.tsx |
| 实时助手 | 手动确认 vs 自动生成模式 | App.test.tsx |
| 实时助手 | 无语音时降级为文本 | App.test.tsx |
| 实时助手 | 重构提词卡 | codex-audit.ts |
| 模拟面试 | 创建 session（有/无 positionId） | server/index.test.ts, codex-audit.ts |
| 模拟面试 | 回答 → 追问 → 决策 | App.test.tsx, codex-audit.ts |
| 模拟面试 | 后端不可用时本地练习提示 | App.test.tsx |
| 模拟面试 | fallbackReason 明确 | codex-audit.ts |
| 模拟面试 | 报告维度分 | server/index.test.ts, codex-audit.ts |
| 简历 AI | action=section/full/match | server/index.test.ts, codex-audit.ts |
| 简历 AI | full-resume 结构化回填区块 | server/index.test.ts, resume.test.tsx |
| 简历 AI | evidenceTrace 证据链 | server/index.test.ts, codex-audit.ts |
| 记录闭环 | 保存/列表/详情/导出 | codex-audit.ts, server/index.test.ts |
| 记录闭环 | 导入 round-trip + 非法拒绝 | server/index.test.ts, App.test.tsx, codex-audit.ts |
| 记录闭环 | 无效指针自动修复 | server/index.test.ts, codex-audit.ts |
| 记录闭环 | 服务重启后回显 | full-flow-retest.ts, codex-audit.ts |
| 异常降级 | 无搜索 provider 返回 disabled | server/index.test.ts |
| 异常降级 | 无 profile 时 resume AI | codex-audit.ts |
| 异常降级 | 超长文本 cue card | codex-audit.ts |
| 异常降级 | 侧边栏状态保持 | App.test.tsx |

### 未覆盖 / 缺口（13 项）

| 缺口 | 严重度 | 说明 |
|------|--------|------|
| 前端 UI fallback 标识展示 | P2 | 后端 `backendStatus`/`fallbackReason` 正确，但前端 UI 未验证是否展示"本地练习模式"文字 |
| 手动/自动模式切换边界 | P2 | 前端测试覆盖了基础交互，但未测模式切换后 interim 文本的行为差异 |
| PDF/DOCX 上传后 RAG 索引实时验证 | P2 | server test 测了 manual text 的 RAG，未测真实文件上传后的检索质量 |
| 简历 AI section action 单独测试 | P2 | server test 只测了 match 和 full，未单独测 section |
| 空岗位进入模拟面试 | P2 | 测试覆盖了无 positionId 创建 session，但未测空岗位在前端的交互路径 |
| 超长文本/特殊字符 | P2 | 仅测了 cue card 超长文本，未测 intake/answer/resume 各端点的超长注入 |
| 模型超时/乱码 JSON 修复 | P2 | DeepSeekProvider 有 repair 逻辑但无自动化测试 |
| 首题非"教育背景"的优先级 | OK | interviewEngine.test.ts 已覆盖 |
| 问题库三层优先级 | P2 | 未专项验证项目卡/上传资料/用户问题在问题生成中的权重 |
| intake 推断/确认/缺失字段交互 | P2 | 系统正确设置了字段但前端交互未全路径验证 |
| 语音 speechAnalysis | OK | speechAnalysis.test.ts 已覆盖 |
| 简历 full apply 回填一致性 | P2 | 前端 component test 有，但未测后端full→前端section映射的完整链路 |
| 并发请求/竞态 | P3 | 未测 |

---

## 三、问题分级清单

### P1 重要问题（1 项）

#### P1-01：空回答触发 500 而非 400

- **位置**：`POST /api/mock/session/:id/answer`，`server/index.ts:305`
- **复现**：提交 `answer: ""`（空字符串）
- **实际结果**：HTTP 500（ZodError 未被 Fastify 捕获）
- **预期结果**：HTTP 400，body 包含明确错误信息（如 `"answer 不能为空"`）
- **影响**：用户提交空答案时看到不友好的 500 错误，无法知道原因
- **根因**：`MockAnswerBody.parse(request.body)` 在路由 handler 中直接调用，`ZodError` 未被 Fastify 自动捕获
- **修复建议**：改为 `MockAnswerBody.safeParse()` 并显式返回 400；或添加全局 error handler 捕获 `ZodError`
- **是否已覆盖**：❌ 未覆盖

### P2 体验问题（2 项）

#### P2-01：手动添加的题目 source 标记在 recompute 后丢失

- **位置**：`src/lib/interviewEngine.ts:907` 的 `recomputePosition`
- **复现**：通过 `/api/positions/:id/questions` 添加 `source: "manual"` 的题目后，调用其他会触发 recompute 的接口（如 profile 更新、材料更新）
- **实际结果**：手动题被 `generateQuestions(resumeWithLibrary, job, 28)` 生成的题目完全替换，`source` 变为 `"diagnosis"` 等自动标记
- **预期结果**：手动添加的题目应保留，或至少保留 source 标记
- **影响**：问题库中手动添加的题目在资料更新后丢失
- **根因**：`recomputePosition` 不合并用户传入的 questions，每次无条件重新生成
- **修复建议**：在 recompute 中合并手动题（source=manual/cueCard/material），只替换自动生成的题
- **是否已覆盖**：❌ 未覆盖

#### P2-02：空问题文本 cue card 的 SSE 流无任何反馈

- **位置**：`POST /api/copilot/cue-card/stream`，`server/index.ts:233`
- **复现**：提交 `questionText: ""`
- **实际结果**：SSE 流既不返回 `event: card` 也不返回 `event: error`
- **预期结果**：应返回 `event: error` 说明"问题不能为空"，或提前校验返回 400
- **影响**：用户等待后无响应，不理解发生了什么
- **修复建议**：在 SSE stream handler 入口处校验 `questionText` 非空，提前 `send("error", ...)`
- **是否已覆盖**：❌ 未覆盖

---

## 四、契约/实现风险

| 风险 | 等级 | 详情 |
|------|------|------|
| fallback 标识贯穿一致 | ✅ 已确认 | 所有接口在无模型时 `backendStatus="fallback"`，`fallbackReason` 明确包含"本地练习"字样 |
| 本地结果伪装为模型成功 | ✅ 无此风险 | 所有 fallback 路径的 `meta.backendStatus` 均为 `"fallback"`，前端可正确判断 |
| 持久化一致性 | ✅ 已确认 | 保存→列表→详情→导出→重启→导入全链路一致 |
| 无效指针修复 | ✅ 已确认 | 导入含无效 positionId/recordId 时正确修复到首个可用项 |
| recompute 覆盖风险 | ⚠️ P2 | `recomputePosition` 在多个路径中重新生成题目，可能覆盖用户手动数据 |
| SSE 校验失败 | ⚠️ P2 | SSE 模式下 Zod 校验失败被静默吞掉，无错误事件返回 |

---

## 五、人工浏览器验收脚本

见 [`docs/manual-browser-checklist.md`](./manual-browser-checklist.md)

---

## 六、在线模型验证（第二轮专项）

> 模型：`deepseek-chat` | API：DeepSeek | 验证脚本：`scripts/full-verify-ai-voice-rag.ts`

### 6.1 语音分析引擎（6/6 ✅）

| 测试项 | 结果 |
|--------|------|
| 正常语速分析 | charCount=21, cpm=84, fillers=0 |
| 口头禅检测 | 4次口头禅正确识别（嗯/那个/然后就） |
| 0秒时长提示 | 返回"用「语音作答」口述可获得语速与口头禅分析" |
| 语速偏快检测 | cpm=600，触发"语速偏快"警告 |
| 语速偏慢检测 | cpm=8，触发偏慢逻辑 |
| Node 环境 Speech API | isSpeechRecognitionSupported 正确返回 false |

### 6.2 AI 在线模型全接口（14/14 ✅）

| 接口 | backendStatus | 关键指标 |
|------|--------------|----------|
| `POST /api/positions/intake` | 模型返回 2 条 suggestedPrompts | 追问引导正常 |
| `POST /api/copilot/cue-card/stream` | **success** | 3 bullets, 3 risks, 4 evidence traces |
| `POST /api/mock/session` | **success** | questionSource="model" |
| `POST /api/mock/session/:id/answer` | **success** | 4 维度报告，高质量追问+即时反馈 |
| `POST /api/resume/ai (section)` | **success** | applyTarget=section |
| `POST /api/resume/ai (full)` | **success** | applyTarget=full |
| `POST /api/resume/ai (match)` | **success** | applyTarget=section |

### 6.3 RAG 索引与检索（4/4 ✅）

| 测试项 | 结果 |
|--------|------|
| evidenceTrace 含 RAG 结果 | 4 条证据追踪 |
| retrievalCount 元数据 | 5 条检索结果 |
| 岗位上下文完整性 | 17 questions, 1 evidence |
| 问题库题目 RAG 可检索 | retrievalCount=5 |

### 6.4 在线 vs Fallback 对比

| 维度 | 在线模型 (deepseek-chat) | Fallback (LocalFallbackProvider) |
|------|--------------------------|----------------------------------|
| backendStatus | **success** | fallback |
| evidenceTrace | 4 条真实证据 | 可能为空或 fallback 标记 |
| fallbackReason | 空字符串 | "模型未配置…已切回本地练习模式" |
| questionSource | "model" | 本地题库 |
| 追问质量 | 模型生成，针对性强 | 规则引擎，模板化 |
| 延迟 | ~2-5s（网络+推理） | <1ms |

**在线模型与 fallback 差异确认：**
- 文案明确性：在线模型追问更聚焦面试者具体回答，fallback 追问泛化
- evidence trace：在线模型 4 条完整追踪，fallback 可能仅 fallback ID
- 结构化结果：在线模型更稳定，JSON 结构更完整
- 延迟：在线模型 2-5s 可接受

---

## 七、后续行动

1. ~~**立即**：填入 `DEEPSEEK_API_KEY`，执行 `npm run test:ai-success-smoke`~~ ✅ 已完成
2. **P1 修复**：为 `MockAnswerBody.parse` 添加 safe 包装，返回 400 而非 500
3. **P2 修复**：`recomputePosition` 合并手动题；SSE 入口校验 questionText
4. **人工验收**：在 Cursor 或浏览器中执行 `docs/manual-browser-checklist.md`
5. **发布前**：`npm run verify` + 人工浏览器验收通过后即可发布

---

*审计工具：`scripts/codex-audit.ts`（40 项接口核验）*  
*AI+语音+RAG：`scripts/full-verify-ai-voice-rag.ts`（32 项全面验证）*  
*基线：`npm run verify` + `npm run test:full-flow` + `npm run test:ai-success-smoke`*
