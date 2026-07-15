# Project Decisions Log — 辅助面试 / AI 求职台

## ADR-P001: 公开 MVP 保持多页面 IA，不做页面合并

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 用户明确要求保留现有多页面结构，认为把功能堆成单页会更乱。
- **Decision**:
  1. 保留首页、实时助手、模拟面试、JD 分析、问题库、简历、记录页
  2. 本轮只做结构收口和体验重排，不做 IA 合并
- **Consequences**: 后续优化必须在现有页面职责内完成，不再建议“一页化”

## ADR-P002: 首页改为真实 JD intake

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 原首页通过推断拼出一段看起来完整的岗位草稿，误导用户把系统猜测当真实岗位信息。
- **Decision**:
  1. 首页只保留真实 intake
  2. 审核卡固定展示 `用户原文`、`系统推断`、`缺失字段`
  3. 所有字段都标记来源
- **Consequences**: 不再保留 `buildDraftJd` 这一类伪造式岗位生成逻辑

## ADR-P003: 数据 owner 收口为后端主导

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 原实现由前端本地 `AppState` 主导，并通过整包 `importToServer` 双写，导致状态真源不清晰。
- **Decision**:
  1. 服务端成为岗位、资料、问题、简历、记录的唯一持久化真源
  2. 前端只保留 `serverSnapshotCache`、`uiPrefs`、`drafts`
  3. 日常写入改为细粒度接口
- **Consequences**: 刷新后以服务端快照恢复，不再依赖本地完整业务状态

## ADR-P004: 最终版方案为主，但采用用户覆盖项

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: `参考资料/产品设计整合优化方案-最终版.md` 仍是主要参考，但其中部分旧判断已被用户显式否定。
- **Decision**:
  1. 继续以最终版方案为主参考
  2. 覆盖以下旧判断：
     - 实时助手自动收起桌面侧栏
     - 问题库弱化用户保存问题和项目资料
     - 简历页右侧非标准聊天面板
- **Consequences**: 当前文档必须明确记录覆盖项，避免后续 agent 回退

## ADR-P005: 公开 MVP 技术架构收口为本地优先单进程

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 当前项目已有 `React + Fastify + SQLite` 骨架，但缺少针对 DeepSeek、RAG、搜索、语音和记录的统一开发前方案，且用户已明确不做多租户、系统音频抓取和原始音频保存。
- **Decision**:
  1. 公开 MVP 保持单机单用户、本地优先单进程
  2. 不引入 ChromaDB、Ollama 作为 MVP 强依赖
  3. 仅保留麦克风/手动输入，不做系统音频抓取
  4. 不保存原始音频，只保存 transcript、指标、提词卡、报告
- **Consequences**: 后续实现必须围绕现有仓库演进，不能偷换成重型云端架构

## ADR-P006: RAG v1 采用 SQLite FTS5 本地检索

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 公开 MVP 需要基于用户简历、JD、项目资料、问题库和记录生成更贴合个人情况的回答，但当前仓库和使用场景都不适合引入额外本地服务。
- **Decision**:
  1. 新增 `documents`、`document_chunks`、`retrieval_runs` 作为 RAG runtime 持久化对象
  2. 使用 SQLite FTS5/BM25 做召回，不额外要求用户安装向量数据库
  3. 召回顺序固定为：项目资料 > 用户问题 > 上传资料 > 简历证据 > 历史记录
  4. 所有 AI 输出都必须带 `evidenceTrace`
- **Consequences**: RAG 实现优先做可部署、可维护、可解释，再考虑后续 embedding/向量化升级

## ADR-P007: P0 先以最小服务层重构打通 RAG、简历 AI 与统一元数据

- **Date**: 2026-06-19
- **Status**: accepted
- **Context**: 当前仓库后端原先几乎全部逻辑堆在单一 orchestrator 中，且没有真实 RAG 持久化和简历 AI 后端能力；如果一次性大拆全部服务层，风险过高且会拖慢 P0 闭环。
- **Decision**:
  1. 保留现有 `server/index.ts` API 路径不变
  2. 新增 `server/rag.ts` 作为最小可用 RAG runtime 层
  3. 继续保留 `server/orchestrator.ts` 作为统一编排入口，但其内部接入 RAG、条件搜索、统一 `PromptRun/AiRunMeta`
  4. 新增 `/api/resume/ai`，让简历页右侧聊天走真实后端能力
- **Consequences**:
  - P0 先获得完整可跑通链路
  - 后续 P1/P2 还可以继续把 `orchestrator` 内部职责再细拆，而不用回退当前接口

## ADR-P008: 项目 skill 引用以“会话可见集合”为准，并维护等价映射

- **Date**: 2026-06-20
- **Status**: accepted
- **Context**: 本机磁盘上实际安装了数百个 skill，但 Codex 单次会话只暴露其中一部分；项目 `AGENTS.md` 里引用的某些历史 skill 名并不会稳定出现在当前会话的 Skills 列表中，导致 agent 无法按文档原名触发。
- **Decision**:
  1. 项目执行时先以“当前会话可见 Skills 列表”为真实可调用集合
  2. `AGENTS.md` 中保留理想 skill 名，但必须为不可见 skill 配置等价映射
  3. agent 发现文档中的 skill 名未暴露时，要明确说明并采用映射后的可见 skill，而不是静默忽略
- **Consequences**:
  - 解决“磁盘已安装但会话未暴露”的认知混乱
  - 后续若平台 skill 注入集合变化，只需调整映射，不必推翻项目规则

## ADR-P009: Codex Desktop 禁止 IAB Browser，验收分流到 Cursor

- **Date**: 2026-06-20
- **Status**: superseded by ADR-P012
- **Context**: 在 Windows + Codex Desktop `0.142.0-alpha.1` 上，调用内置 Browser（IAB）会在 `browser.tabs.new()` / `created browser use host` 阶段导致 Electron 进程重启，表现为 Codex 闪退；同线程多次 `interrupted`。
- **Decision**:
  1. 在 `~/.codex/config.toml` 永久关闭 `browser`、`chrome`、`computer-use`、`build-web-apps` 插件，并清空 `BROWSER_USE_AVAILABLE_BACKENDS`
  2. 在 Codex `persistent_instructions` 与项目 `AGENTS.md` 写入硬门禁：Codex 不得调用任何 IAB / Browser / Computer Use 路径
  3. 渲染层 UI 验收只在 **Cursor Browser/Playwright MCP** 或人工浏览器进行
  4. Codex 交付以 `npm run verify` + 接口链路 / Vitest 替代 Browser 冒烟
  5. 提供 `scripts/ensure-codex-browser-stability.py` 作为可重复执行的守卫脚本
- **Consequences**:
  - Codex 不再具备内置 Browser 能力，但可稳定完成代码与后端验收
  - 若 OpenAI 修复 Windows IAB 崩溃，需重新评估后再手动启用插件

## ADR-P012: Codex 浏览器能力全局重新启用，强制 Chrome 后端

- **Date**: 2026-07-06
- **Status**: accepted
- **Context**: 用户要求彻底删除全局禁用浏览器配置。另一个 Codex 线程的闪退发生在直接调用内置 `setupBrowserRuntime` / IAB 路径后；继续全局禁用 Browser/Chrome/Computer Use 会阻断真实渲染层验收，但保留 IAB 后端会再次触发 Codex Desktop 闪退。
- **Decision**:
  1. `~/.codex/config.toml` 中 `browser@openai-bundled`、`chrome@openai-bundled`、`computer-use@openai-bundled`、`build-web-apps@openai-api-curated` 全部启用
  2. `BROWSER_USE_AVAILABLE_BACKENDS` 固定为 `chrome`，不再暴露 `iab` 后端给运行时选择
  3. 删除项目级 `ensure-codex-browser-stability.*` 守卫脚本和“Codex 禁用浏览器”门禁
  4. `~/.codex/tools/ensure-codex-plugins.ps1` 收窄为浏览器/网页能力健康检查，避免旧插件命名空间误报
  5. 后续浏览器工具失败应记录为工具故障，不得重新写入全局禁用配置
  6. 新增 `npm run test:browser-flow` / `test:browser-flow:headed` 作为外部 Playwright 用户流验收脚本（来自 `codex/full-usability-fix`）
- **Consequences**:
  - Codex 可以再次加载 Browser / Chrome / Computer Use 插件
  - 真实浏览器验收恢复为默认交付要求，默认走系统 Chrome 后端
  - 内置 IAB 闪退路径不再作为可选后端暴露；后续不得把 `chrome,iab` 写回全局配置
  - 项目同时保留外部 Playwright 脚本作为兜底与自动化验收路径

## ADR-P010: 上线阻塞项收口采用服务端访客 cookie 与 owner-scoped RAG

- **Date**: 2026-07-04
- **Status**: accepted
- **Context**: 上线前复核发现 Docker 生产监听、密钥打包、无身份访客共享桶、RAG 简历索引跨 owner 覆盖、本地 outbox 被 Git 跟踪等阻塞项。
- **Decision**:
  1. 生产默认监听 `0.0.0.0`，支持平台 `PORT`，Docker 显式设置 `HOST=0.0.0.0`
  2. Docker 构建上下文排除 `.env` / `.env.*`，真实密钥只通过部署环境变量注入
  3. 未登录访客优先用 `x-guest-id`；无本地存储时由服务端下发 HttpOnly 匿名 cookie，不再写共享访客桶
  4. RAG 文档唯一键改为 `owner_key + source_type + source_id`，文档 id 带 owner，避免多用户索引覆盖
  5. `.data/mail-outbox.json` 从工作树删除并加入忽略，测试 outbox 改写入临时目录
- **Consequences**:
  - 公开部署时不会因容器绑定回环地址而无法访问
  - 多访客/多账号资料不会因无身份或 RAG 固定 id 互相覆盖
  - full-flow 验收脚本必须像浏览器一样保留服务端 cookie，并对关键 200/持久化结果硬失败

## ADR-P011: 实时助手多轮提词卡采用 owner-scoped session 持久化

- **Date**: 2026-07-05
- **Status**: accepted
- **Context**: 真实用户在实时助手中会连续生成 3-4 轮提词卡；原实现只保留当前卡片和本地前端列表，刷新、切换账号或复盘时缺少服务端可验证的多轮历史，也容易和账号/访客数据隔离要求冲突。
- **Decision**:
  1. 新增 `LiveCueSessionRecord` 服务端类型，记录 `positionId`、多轮 `history`、`createdAt/updatedAt`
  2. SQLite 新增 `live_cue_sessions` 表，并通过 `user_id` 做 owner-scoped 访问；file fallback 新增 `userLiveCueSessions`
  3. `/api/copilot/cue-card/stream` 请求体接受可选 `sessionId`，`card` SSE payload 返回 `sessionId/history`
  4. 删除岗位相关数据时同步清理该 owner 下的 live cue session
- **Consequences**:
  - 实时助手多轮历史可以跨前端组件状态回传和展示，但仍不引入新的岗位字段 schema
  - 账号/访客隔离沿用当前 owner 体系，避免提词卡历史串号
  - 后续若做记录页复盘增强，可直接复用 session history，而不需要从前端临时状态反推
