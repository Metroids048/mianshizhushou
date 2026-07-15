# AI 求职台 AI 能力架构蓝图（MVP / AI·数据闭环）

版本：v2.0  
更新时间：2026-06-22  
适用范围：公开 MVP 阶段  

---

## 1. 文档定位

这份文档不再只是“列出哪些地方可以加 AI”，而是作为 AI 求职台的 AI 能力总纲，回答 4 个核心问题：

1. 当前产品里，哪些链路已经真实接入了 AI、大模型、RAG 和语音能力。
2. 当前缺的不是哪一个 prompt，而是哪一类 AI 契约还没有收口。
3. 后续所有 prompt、skills、模型编排、联网检索、fallback 应该如何统一归位。
4. 在公开 MVP 阶段，怎样做到“可实现、可验证、可演进”，而不是继续堆概念。

本文严格以当前仓库为边界，不重新发明一套脱离实现的 AI 平台架构。

---

## 2. 结论先行

按当前仓库状态，产品对以下核心卖点已经具备主链路雏形：

- 语音实时识别
- 模型对话生成
- RAG 本地检索增强
- JD 分析
- 简历优化
- 模拟面试追问与复盘

但整体仍然只能判断为：

**主链路已成型，AI 契约未收口。**

当前最大的缺口不是“少几个 prompt”，而是还缺少统一的：

- 功能分层
- 产品级 skills 能力模块
- 模型路由策略
- structured outputs 契约
- RAG / Web Search 触发规则
- fallback 透明规范
- prompt 回归评测机制

完成本文与配套 prompt spec 文档后，产品的 AI 层可以达到：

- MVP 级：可实现
- MVP 级：可验证
- MVP 级：可演进

但还**不等于商用级**。商用前仍需补：

- 前端内联 prompt 全量收口到后端
- 更严格的 structured outputs 与 schema 校验
- prompt eval / regression 体系
- skills 到 orchestrator / routes 的正式映射

---

## 3. AI 功能分层图

AI 求职台在 MVP 阶段的 AI 能力建议固定拆成 8 层。后续所有 prompt、skills、编排接口都必须归位到这 8 层之一，避免再次出现“功能写了，但不知道归谁管”的问题。

| 层级 | 职责 | 当前典型功能 |
|---|---|---|
| 输入理解 | 把用户原始输入转成可继续处理的结构化上下文 | JD intake、语音转写、用户补充说明 |
| 证据提取 | 从简历、项目资料、历史记录中抽取可引用证据 | 简历 evidence、材料解析、关键词抽取 |
| 实时辅助 | 面试中低时延生成提词、追问准备、即时帮助 | cue-card、cue-card reconstruct |
| 模拟面试 | 出题、追问、切题、即时反馈、整场面试节奏控制 | mock interviewer、mock decision |
| 简历优化 | 对当前区块、整份简历、JD 匹配进行建议与改写 | resume ai、highlight、evidence-bound rewrite |
| 研究检索 | 对公司、岗位、行业等时效性信息做条件联网研究 | search summary、company/role research |
| 复盘评估 | 对一次问答或整场记录做结构化评分和建议 | report、mock report、speech metrics 结合评价 |
| 平台治理 | 统一 schema、RAG、search、fallback、日志、eval | prompt registry、orchestrator、prompt runs、retrieval runs |

### 3.1 分层原则

- 同一个功能只能有一个主归属层。
- 同一个 prompt 不同时承担“提取 + 改写 + 评分 + 搜索研究”四种职责。
- UI 文案不是 AI 层的职责，AI 层只输出契约化结果。
- 平台治理层不直接面向用户，但必须决定产品的真实稳定性。

---

## 4. 现状审计

### 4.1 当前已经真实存在的能力底座

从仓库现状看，AI 主链路不是空白，已经存在以下真实能力：

- `server/prompts/registry.ts`
  - 已存在 9 个后端 prompt 定义
  - 但多数 prompt 仍偏薄，更像“短 system 指令”，不是完整 spec

- `server/orchestrator.ts`
  - 已接入并统一编排：
    - `cue-card`
    - `cue-card reconstruct`
    - `mock interviewer`
    - `mock decision`
    - `resume ai`
    - `jd analysis`
    - `report`
    - `retrieval`
    - `conditional search`
  - 已经是当前 AI 主链路的真实 owner

- `server/rag.ts`
  - 已具备本地检索增强能力
  - 当前方向是 SQLite FTS 为主的轻量 RAG

- `server/ai/provider.ts`
  - 当前模型调用策略是：
    - 首次调用
    - 尝试 JSON 解析
    - 失败后追加 repair 消息重试一次
    - 再失败就 fallback
  - 这是一个可用但还不够强的 structured output 方案

- `src/components/live.tsx` 与 `src/lib/speech.ts`
  - 已经实现语音识别三态：
    - `interim`
    - `final`
    - `editable`
  - 这个能力必须从“实现细节”升级为“正式产品契约”

### 4.2 当前仍未收口的问题

当前问题主要不是“没有 AI”，而是“AI 分散且口径不一”：

- `src/lib/aiAnalysis.ts`
  - 仍有前端内联 prompt
  - 题库生成、评分、追问绕过了后端统一 guardrails 与 promptRun

- `src/lib/coach.ts`
  - 仍有前端内联 prompt
  - 简历亮点生成没有纳入后端统一契约

- Prompt 现状
  - 后端 prompt registry 已存在，但 prompt 颗粒度不均
  - 前端与后端并存两套思路，造成行为不一致

- 输出契约现状
  - 目前主要依赖“模型尽量输出 JSON + 本地 repair”
  - 还没有形成统一的严格 schema-first 规范

- 搜索与 RAG 现状
  - 已接入条件搜索与本地检索
  - 但还缺少清晰的“什么时候检索、什么时候搜索、什么时候明确标注不足”的产品规则

### 4.3 当前状态判断

| 维度 | 当前状态 | 结论 |
|---|---|---|
| 主链路是否存在 | 是 | 已形成 MVP 雏形 |
| Prompt 是否统一管理 | 部分统一 | 仍有前端绕行 |
| 输出是否强约束 | 中等 | 可用但不稳定 |
| RAG 是否存在 | 是 | 已有轻量底座 |
| Web Search 是否存在 | 是 | 需进一步产品化规则 |
| fallback 是否透明 | 部分透明 | 仍需统一规范 |
| eval 是否完备 | 否 | 是下一阶段硬缺口 |

---

## 5. 产品级 Skills 地图

本文中的 `skills` 定义为：**面向产品 AI 功能的能力模块**。  
它不是 Codex 的工程 skill，也不是给开发写代码时调用的提示模板，而是后续所有 AI 功能设计、prompt 编排、模型调用和验收的统一能力目录。

后续建议固定为以下 12 个产品侧 skills。

### 5.1 `jd_intake_normalizer`

- 功能目标：把原始 JD 文本、补充说明和用户确认信息整理成结构化岗位上下文
- 上游输入：JD 原文、用户确认字段、岗位补充消息
- 下游输出：标准化岗位信息、缺失字段、需要继续追问的缺口
- 是否需要 RAG：否
- 是否允许联网：否
- 输出 schema：岗位字段、字段来源、缺失字段、建议追问
- latency 目标：1500-2500ms
- fallback：本地规则提取 + 字段缺失提示
- 典型失败模式：
  - JD 文本过短
  - 岗位字段歧义
  - 用户只给出零散岗位标签

### 5.2 `jd_match_diagnosis`

- 功能目标：诊断 JD 与简历/证据库的匹配点、缺口和准备重点
- 上游输入：岗位上下文、简历 evidence、match report、RAG 片段
- 下游输出：匹配概述、命中证据、风险、准备建议、可能问题
- 是否需要 RAG：是
- 是否允许联网：默认否
- 输出 schema：`summary / overlapEvidence / risks / preparationAdvice / questions`
- latency 目标：2500-4000ms
- fallback：现有本地 `matchReport` 与题库结果
- 典型失败模式：
  - 简历证据不足
  - 输出过于模板化
  - 把“岗位要求”误写成“候选人已有能力”

### 5.3 `resume_evidence_extractor`

- 功能目标：从简历和资料中抽取可复用的真实证据
- 上游输入：简历文本、项目资料、材料摘要
- 下游输出：evidence cards、关键词、impact、待补充字段
- 是否需要 RAG：可选
- 是否允许联网：否
- 输出 schema：`evidence[]`
- latency 目标：2500-3500ms
- fallback：本地规则 evidence 解析
- 典型失败模式：
  - 团队成果误判为个人成果
  - 量化结果缺失
  - 技能标签泛化

### 5.4 `resume_optimizer`

- 功能目标：对当前区块、整份简历或岗位匹配方向给出证据约束建议
- 上游输入：简历当前区块、全量简历、岗位上下文、evidence、RAG
- 下游输出：建议文本、改写文本、建议应用目标、引用证据
- 是否需要 RAG：是
- 是否允许联网：默认否
- 输出 schema：`reply / suggestion / applyTarget / evidenceIds`
- latency 目标：2000-3500ms
- fallback：本地规则建议
- 典型失败模式：
  - 编造数据
  - 建议不贴当前岗位
  - 一次输出过多不可执行建议

### 5.5 `question_bank_generator`

- 功能目标：围绕当前岗位自动生成高概率题库与回答准备方向
- 上游输入：JD、简历证据、历史 mock turns、match report
- 下游输出：问题列表、分类、难度、理由、建议答案方向
- 是否需要 RAG：建议是
- 是否允许联网：默认否
- 输出 schema：题目数组与 answer draft
- latency 目标：3000-5000ms
- fallback：本地 question bank 规则生成
- 典型失败模式：
  - 题目重复
  - 题目过泛
  - 题目与岗位无关

### 5.6 `live_cue_card_coach`

- 功能目标：在实时问答中生成低时延提词卡
- 上游输入：用户问题、岗位上下文、证据库、最近对话、RAG、可选 search
- 下游输出：提词卡六维结构
- 是否需要 RAG：是
- 是否允许联网：条件允许
- 输出 schema：`strategy / openingLine / bullets / evidenceIds / risks / followUps`
- latency 目标：1500-2500ms
- fallback：本地 cue-card 规则引擎
- 典型失败模式：
  - 编造经历
  - 输出整段逐字稿
  - 未命中真实 evidence

### 5.7 `cue_card_rewriter`

- 功能目标：根据用户反馈对已有提词卡做定向重构
- 上游输入：原卡、用户反馈、岗位上下文、证据、RAG
- 下游输出：修正版提词卡
- 是否需要 RAG：建议是
- 是否允许联网：否
- 输出 schema：与 cue-card 相同
- latency 目标：1500-2500ms
- fallback：保留原卡
- 典型失败模式：
  - 用户只要求局部修改，却被整体重写
  - 丢失原本正确的 evidence
  - 反馈类型识别错误

### 5.8 `mock_interviewer`

- 功能目标：生成模拟面试首题与后续题风格
- 上游输入：岗位、简历证据、题库、RAG、面试人格配置
- 下游输出：问题、分类、难度、出题原因
- 是否需要 RAG：是
- 是否允许联网：否
- 输出 schema：`question / category / difficulty / reason`
- latency 目标：1500-2500ms
- fallback：本地优先题库选题
- 典型失败模式：
  - 首题过难
  - 连续围绕同一经历
  - 与人格配置不一致

### 5.9 `followup_decider`

- 功能目标：判断是继续追问还是进入下一题，并给即时反馈
- 上游输入：当前问题、候选人回答、对话历史、局部评分、RAG
- 下游输出：`followup | next` 决策、下一问、即时反馈、内部说明
- 是否需要 RAG：是
- 是否允许联网：否
- 输出 schema：`type / question / instantFeedback / internalNote`
- latency 目标：1800-2800ms
- fallback：本地回答结构规则
- 典型失败模式：
  - 追问不绑定刚才回答
  - 本该切题却继续纠缠
  - 即时反馈空泛

### 5.10 `report_scorer`

- 功能目标：对单轮或整场模拟面试记录生成评分与改进建议
- 上游输入：transcript、mock turns、speech metrics、JD、RAG
- 下游输出：总分、维度分、优点、问题、下一步练习建议
- 是否需要 RAG：是
- 是否允许联网：否
- 输出 schema：`overallScore / dimensions / strengthPoints / improvementPoints / suggestedNextPractice / summary`
- latency 目标：2500-4000ms
- fallback：本地评分报告
- 典型失败模式：
  - 只会笼统夸奖
  - 分数和点评不一致
  - 未绑定具体 transcript

### 5.11 `company_role_researcher`

- 功能目标：对公司、岗位、行业做时效性研究补充
- 上游输入：公司名、岗位名、当前问题、搜索结果
- 下游输出：事实摘要、风险、来源
- 是否需要 RAG：否
- 是否允许联网：是，且只在时效性问题下启用
- 输出 schema：`facts / risks / sources`
- latency 目标：2500-4500ms
- fallback：显示“搜索未接通，仅使用本地资料”
- 典型失败模式：
  - 伪造来源
  - 用搜索事实替代候选人本地证据
  - 把弱来源写成确定事实

### 5.12 `rag_grounding_checker`

- 功能目标：检查模型输出是否真实绑定了当前证据、RAG 片段和字段来源
- 上游输入：模型输出、evidenceIds、retrievedContext、searchResults
- 下游输出：grounding 状态、缺口、需要降级的理由
- 是否需要 RAG：是
- 是否允许联网：否
- 输出 schema：grounding 校验结果
- latency 目标：附着在主调用后，不单独暴露给用户
- fallback：至少保留本地 evidenceId 白名单校验
- 典型失败模式：
  - evidenceId 不存在
  - 引用了无关 chunk
  - 搜索摘要与回答内容冲突

---

## 6. 全局模型配置策略

### 6.1 公开 MVP 统一原则

MVP 阶段不追求“全模型大战略”，只追求稳定和可解释。  
当前架构默认服务于：

- DeepSeek 主模型
- Fastify 编排
- SQLite / FTS 检索
- Web Speech API

不引入新的重型基础设施作为前置依赖。

### 6.2 按任务类型分层配置

#### 低时延实时型

适用功能：

- 实时提词卡
- 实时追问
- mock 首题生成
- mock 决策

策略：

- 短上下文优先
- 强 schema
- 优先使用当前岗位 + 最近轮次 + 高相关 evidence
- 必须具备本地 fallback
- UI 必须可区分 `success / fallback / cache`

#### 结构化提取型

适用功能：

- JD 诊断
- 简历证据抽取
- 项目资料解析
- RAG grounding check

策略：

- 低温度
- evidence-bound
- 结构化输出优先于语言润色
- 缺失字段必须显式标注

#### 深度分析型

适用功能：

- 简历优化
- 面试报告评分
- 匹配分析

策略：

- 允许适度生成
- 但所有建议必须可溯源到现有证据、岗位或 transcript
- 禁止把“建议补充”写成“已经具备”

#### 搜索研究型

适用功能：

- 公司研究
- 岗位研究
- 行业动态
- 时效性版本变化

策略：

- 只回答时效性事实
- 不替代用户本地证据
- 搜索失败不阻塞主流程
- 来源必须保留

### 6.3 Structured Outputs 策略

当前 `server/ai/provider.ts` 已具备基础 JSON repair 能力，但后续应统一升级到“schema-first”思路：

1. 所有核心 prompt 都先定义输出 schema。
2. 编排层把 schema 与 guardrails 一起传入模型上下文。
3. 首轮输出失败时才做 repair，而不是先接受自由文本。
4. 失败后降级到 fallback，并在状态、日志、报告中同时标出。

这里的定标来源建议采用 OpenAI 官方关于：

- Structured Outputs
- Function Calling / strict schema
- Realtime transcription
- File Search / Web Search tools

用于方法论，不等于仓库必须直接接 OpenAI API。

---

## 7. RAG + Web Search 决策规则

### 7.1 RAG 的地位

RAG 在本产品里属于主链路，不是附加特效。

公开 MVP 阶段，RAG 优先检索：

1. 当前岗位
2. 当前简历证据
3. 当前岗位资料
4. 当前岗位问题库
5. 当前记录 transcript / report

如果无命中：

- 不允许假装“已结合资料分析”
- 必须明确写为“检索不足”或“仅基于当前输入”

### 7.2 Web Search 的地位

Web Search 是条件工具，不是默认前置。

只有以下场景才建议触发：

- 公司最新动态
- 行业趋势
- 技术版本变化
- 时效性岗位研究

以下场景不应该优先走搜索：

- 候选人自己的简历事实
- 候选人的项目经历
- 提词卡中的 evidence
- 简历优化中的量化结果

### 7.3 决策表

| 场景 | 优先走本地资料 | 允许 RAG | 允许 Web Search | 必须显式状态 |
|---|---|---|---|---|
| JD 匹配分析 | 是 | 是 | 否 | 是 |
| 简历证据抽取 | 是 | 可选 | 否 | 是 |
| 实时提词卡 | 是 | 是 | 条件允许 | 是 |
| 模拟面试追问 | 是 | 是 | 否 | 是 |
| 公司/岗位研究 | 否 | 否 | 是 | 是 |
| 报告评分 | 是 | 是 | 否 | 是 |

### 7.4 fallback 透明规则

fallback 一律不可伪装为模型成功。

至少要在以下 3 个位置统一体现：

- UI 状态
- prompt run / retrieval run 日志
- 最终报告或返回 meta

必须可区分：

- 模型成功
- 模型 fallback
- cache
- 搜索未接通
- 检索不足

---

## 8. 外部资料应如何吸收

本项目后续参考外部资料时，不应做“仓库收藏夹”，而应转成设计模式。

### 8.1 OpenAI 官方资料的作用

OpenAI 官方资料在本项目中的作用是**定标 AI 产品契约写法**，重点参考：

- Structured Outputs
- Realtime Transcription
- File Search
- Web Search
- Function Calling / strict mode

吸收方式：

- 用它们来规范 prompt 和 output contract 写法
- 用它们来定义 tool / schema / grounding 的规则
- 不直接把 OpenAI 的产品结构照抄进本仓库

### 8.2 promptfoo 的作用

`promptfoo` 在本项目里的价值不是“又一个框架”，而是帮助建立：

- prompt 回归测试
- golden set
- 红队测试
- A/B 对比

这直接对应本项目当前最缺的“AI 契约可验证性”。

### 8.3 GitHub 求职相关项目的作用

GitHub 上和求职、面试、简历优化高度相关的项目，应只提炼为以下 4 类模式：

#### 模式 A：实时转写 + 低时延回答链路

可借鉴点：

- 如何把转写、问题理解、回答辅助拆开
- 如何处理低时延链路中的占位与模型结果覆盖
- 如何在实时场景中保持 fallback 透明

优先参考：

- [hariiprasad/interviewcopilot](https://github.com/hariiprasad/interviewcopilot)
- [innovatorved/realtime-interview-copilot](https://github.com/innovatorved/realtime-interview-copilot)
- [interview-copilot/Interview-Copilot](https://github.com/interview-copilot/Interview-Copilot)

#### 模式 B：JD ↔ 简历匹配与证据化改写

可借鉴点：

- 怎样做岗位匹配分析
- 怎样把“建议”绑定到真实 evidence
- 怎样避免把优化建议写成简历造假

优先参考：

- [srbhr/resume-matcher](https://github.com/srbhr/resume-matcher)

#### 模式 C：模拟面试多轮追问与评分

可借鉴点：

- 出题与追问分离
- 即时反馈与整场报告分离
- 人格化面试官和结构化评分并存

优先参考：

- interview copilot 类仓库中的多轮会话处理模式

#### 模式 D：本地资料 + 检索增强 + 明示 fallback

可借鉴点：

- 把本地资料检索和外部信息补充分层
- 搜索未接通时不阻塞主流程
- 证据不足时不伪造回答

这类模式更适合结合本仓库现有 `server/rag.ts + orchestrator + promptRun` 来实现。

---

## 9. MVP 差距与优先级

### 9.1 P0：必须收口

1. 前端内联 prompt 收口
   - 当前涉及：
     - `src/lib/aiAnalysis.ts`
     - `src/lib/coach.ts`
   - 目标：统一纳入后端 prompt registry / orchestrator / promptRun

2. Prompt spec 统一模板化
   - 当前 prompt 质量不均
   - 目标：所有核心能力都有 schema、guardrails、fallback、eval

3. fallback 透明规范统一
   - 当前已有部分透明，但口径仍不完全统一
   - 目标：UI、日志、报告统一状态词

4. 语音三态契约正式化
   - `interim / final / editable`
   - 必须从实现细节升级为产品验收标准

### 9.2 P1：显著提升体验与稳定性

1. structured outputs 强化
2. RAG grounding check 接入主链路
3. JD intake 追问式补全 prompt
4. 简历 evidence extractor 正式纳入后端
5. prompt golden set 建立

### 9.3 P2：为后续商用准备

1. promptfoo 回归测试流水线
2. 更完整的检索冲突处理
3. 多模型路由与成本策略
4. 更细粒度的安全红队用例

---

## 10. MVP 统一验收口径

AI 能力验收不能只写 `npm run verify`。

本文建议同步固化以下专项验收：

### 10.1 Prompt 结构化验收

- 核心结构化 prompt 首次 schema 解析成功率目标 `>= 90%`
- repair 只能作为兜底，不是常态

### 10.2 Evidence 真实性验收

- `evidenceIds` 必须全部来自真实输入
- 不允许输出虚构引用
- 证据不足时必须明确提示补充

### 10.3 fallback 透明验收

- 模型失败、搜索失败、RAG 无命中时必须可区分
- 不能把本地规则包装成模型成功

### 10.4 语音链路验收

- 停止听取后保留 `final / editable`
- 只有清空/重录才清空
- 自动生成与手动生成都可用

### 10.5 mock 链路验收

- 首题优先后端模型
- 追问/下一题优先后端模型
- 报告优先后端模型
- 失败时明确本地练习模式

### 10.6 检索链路验收

同一问题在以下场景下都必须有预期输出：

- 有资料命中
- 无资料命中
- 资料冲突

### 10.7 安全验收

以下输入必须触发拒绝、澄清或降级：

- 简历夸大
- JD prompt injection
- 搜索噪声
- RAG 无关片段
- 用户要求编造经历

---

## 11. 本文约束的实现方向

后续所有详细 prompt 设计，统一由：

- [参考资料/AI功能Prompt设计完整方案.md](C:/Users/Windows11/Desktop/辅助面试/参考资料/AI功能Prompt设计完整方案.md)

负责承接。

实现层面则继续围绕当前仓库这些真实落点推进：

- `server/prompts/registry.ts`
- `server/orchestrator.ts`
- `server/ai/provider.ts`
- `server/rag.ts`
- `src/lib/aiAnalysis.ts`
- `src/lib/coach.ts`
- `src/components/live.tsx`

---

## 12. 最终判断

对当前产品来说，AI 不是锦上添花，而是主卖点本身。

因此后续工作重点不应再是：

- 多加几个“看起来完整”的 prompt
- 多列几条 AI 功能点
- 多找几个开源仓库做参考清单

而应是把以下内容真正收口成统一契约：

- 功能归层
- skills 归位
- prompt spec
- schema 输出
- RAG / Search 决策
- fallback 透明
- eval 验证

只有这样，AI 求职台的“语音实时识别 + 模型对话 + RAG + JD 分析 + 简历优化”才能从“有功能演示”升级成“可持续迭代的 MVP 能力系统”。
