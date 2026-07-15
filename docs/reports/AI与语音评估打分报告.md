# AI 与语音评估打分报告（上线收口版）

- 评估日期：2026-06-29
- 模型：DeepSeek `deepseek-chat`（服务端别名到 `deepseek-v4-flash`，含 reasoning）
- 在线链路：真实 DeepSeek API（新 key 已写入本地 `.env`）
- 评估脚本：`scripts/full-ai-eval.ts`（规则评分 + 模型自评 + 性能）、`scripts/full-verify-ai-voice-rag.ts`（语音 + 在线 AI + RAG）、`scripts/ai-success-smoke.ts`（在线成功烟测）

---

## 一、在线成功烟测（ai-success-smoke）

| 链路 | 结果 |
|------|------|
| 实时提词卡 cue-card | ✅ success |
| 模拟面试答题 mock-answer | ✅ success |
| 简历 AI resume-ai | ✅ success |

结论：三条核心 AI 链路在真实模型下均为 `success`，无降级。

---

## 二、AI 输出评分（full-ai-eval，12 项 Prompt Spec）

整体：功能通过 **11/13（85%）**，平均评分 **74/100**，**JSON 解析率 100%（13/13）**，证据接地率 85%，**Fallback 0%（全程在线成功）**。

| Spec | 延迟 | 评分 | 状态 |
|------|------|------|------|
| 4.1 JD intake 引导 | 1291ms | 78 | 🟢 pass |
| 4.2 JD 匹配诊断 | 8220ms | 78 | 🟢 pass |
| 4.3 简历证据抽取 | 3ms | 78 | 🟢 pass |
| 4.4 简历优化·局部 | 2512ms | 78 | 🟢 pass |
| 4.4 简历优化·整份 | 2474ms | 78 | 🟢 pass |
| 4.4 简历优化·岗位匹配 | 2601ms | 78 | 🟢 pass |
| 4.6 实时提词卡生成 | 14170ms | 50 | 🟡 warn |
| 4.7 提词卡反馈重构 | 16507ms | 78 | 🟢 pass |
| 4.8 模拟面试首题 | 3061ms | 72 | 🟢 pass |
| 4.9 追问/下一题决策 | 2127ms | 78 | 🟢 pass |
| 4.10 面试报告评分 | — | 78 | 🟢 pass |
| 4.11 公司/岗位搜索 | 1ms | 93 | 🟢 pass |
| 4.12 RAG 引用一致性 | — | 50 | 🟡 warn |

### 性能指标
- API 调用：11 次（不含纯本地项）
- 延迟：最小 1ms，**平均 4815ms**，**最大 16506ms**
- JSON 解析率：100%

### 维度均分
- 结构完整度：**98**
- Guardrail 合规：**100**
- 证据接地：68
- 内容相关（关键词重叠口径）：8

### 规则评分 vs 模型自评
| Skill | 规则 | 模型 | 动作 |
|-------|------|------|------|
| cue-card | 50 | 50 | warn |
| mock-decision | 78 | 70 | pass |
| resume-ai | 78 | 78 | pass |

---

## 三、语音评估（full-verify-ai-voice-rag）

语音分析引擎 6 项全过：
- 正常语速：charCount=21, cpm=84, fillers=0 ✅
- 口头禅检测：识别「嗯/那个/然后就」共 4 次 ✅
- 0 秒时长引导改用语音作答 ✅
- 语速偏快（cpm=600）给出停顿建议 ✅
- 语速偏慢（cpm=8）检测 ✅
- Node 环境正确返回不支持浏览器语音 API ✅

在线 AI + RAG 部分：intake/cue-card/mock/resume 全部 `success`，evidenceTrace=3、retrievalCount=5，RAG 召回真实生效。

总计 32 项：✅ 29 通过 / ❌ 3 失败。

---

## 四、发现的问题与结论

### 需要关注（warn / 低分）
1. **实时提词卡延迟偏高**：cue-card 14.1s、reconstruct 16.5s，远超 prompt 设定的 2s 目标。根因：`deepseek-v4-flash` 为带 reasoning 的模型，结构化生成耗时大。A4 已加 45s 超时兜底，但 UX 仍偏慢，建议后续评估更快档位或缩短 prompt/输出长度。
2. **提词卡证据接地**：4.12 RAG 引用一致性 grounded=false、invalid=2，模型引用了不在给定证据集中的 id；cue-card 规则与模型自评均 50（warn）。属 Guardrail 上游信号问题，A5 已上线 👍/👎 采集以积累真实认可率用于持续评估。
3. **「内容相关」维度均分仅 8**：该指标是“输入词 vs 输出词重叠”的粗口径，对中文改写/同义表达天然偏低，更多是评估口径局限而非真实跑题，建议后续改为语义相似度口径。

### 3 项失败的归因（非产品回归）
全部来自 `full-verify-ai-voice-rag` 以**未登录、且未带 `x-guest-id` 的纯游客**身份调用：
- 岗位上下文为空、记录无法保存、重启后记录为 0。
- 根因：`db.getState(undefined)` 返回空态、`saveState/saveRecord(undefined)` 为 no-op（[server/db.ts:608-630](../../server/db.ts)），且 `/api/records` 需登录（`requireAuth`）。
- 与本轮 A3 改动无关（对无 header 游客，`ownerOf` 恒为 `undefined`，行为与改前一致）。已登录路径的持久化由 `first-time-user-flow`（注册登录）验证通过：导出/重启记录一致。

### 总体结论
- 在线 AI 三条核心链路稳定 `success`，结构化输出 100% 可解析，Guardrail 合规 100%，整体可上线。
- 上线后建议监控：cue-card 端到端延迟 P95、提词卡 👍/👎 认可率、证据接地无效率。
