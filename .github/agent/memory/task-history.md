# Task History

## [TASK-2026-07-06-codex-external-browser-flow]

- Date: 2026-07-06
- Type: tooling/test/config
- Summary: 将 Codex 浏览器验收从“完全禁止渲染层”调整为“禁止内置 IAB/Browser 闪退路径，允许外部 Playwright/系统 Edge 自动化”。删除项目内 `ensure-codex-browser-stability.*` 守卫脚本，新增外部浏览器真实用户流脚本，支持无头和可见浏览器两种模式。
- Files:
  - `AGENTS.md`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `docs/manual-browser-checklist.md`
  - `package.json`
  - `package-lock.json`
  - `vite.config.mjs`
  - `scripts/external-browser-user-flow.ts`
  - `web/artifacts/external-browser-flow/desktop-records-1280x720.png`
  - `web/artifacts/external-browser-flow/mobile-records-390.png`
- Verified:
  - `npm.cmd run test:browser-flow`：Pass，外部无头浏览器完成注册、跳过引导、首页 JD、实时助手提词卡、模拟面试回答、保存记录与 390px 溢出检查
  - `npm.cmd run test:browser-flow:headed`：Pass，外部可见浏览器完成同一真实用户流
  - `npm.cmd run verify`：lint 0 error / 15 warnings，18 test files / 118 tests passed，build 成功
- Notes:
  - 本次没有调用 Codex 内置 Browser/IAB/Chrome/Computer Use 插件
  - 临时前端 `15173` 与后端 `18787` 在脚本结束后已停止

## [TASK-2026-07-06-real-user-acceptance-report]

- Date: 2026-07-06
- Type: test/docs
- Summary: 按“全站真实用户闭环验收计划”完成 Codex 侧自动化验收、接口矩阵审计、首次用户脚本、AI+语音+RAG 专项验证，并产出 docs 报告与真实浏览器补验清单。修正 `scripts/codex-audit.ts` 与 `scripts/full-verify-ai-voice-rag.ts` 的验收口径：先注册真实用户并携带 Authorization 调用 owner-scoped 接口，避免把账号隔离后的 401/404 误判为产品缺陷；空回答/空问题按后端 400 校验拦截判定为通过。
- Files:
  - `scripts/codex-audit.ts`
  - `scripts/full-verify-ai-voice-rag.ts`
  - `docs/acceptance/真实用户全流程验收报告-2026-07-06.md`
  - `docs/acceptance/真实浏览器补验清单-2026-07-06.md`
  - `.github/agent/memory/task-history.md`
- Verified:
  - `node node_modules/tsx/dist/cli.mjs scripts/codex-audit.ts`：40/40 Pass，P0/P1/P2 均为 0
  - `node node_modules/tsx/dist/cli.mjs scripts/full-verify-ai-voice-rag.ts`：32/32 Pass
  - `npm.cmd run verify:acceptance`：lint 0 error / 15 warnings，18 test files / 118 tests passed，build 成功，app 46/server 40/full-flow/AI smoke 通过
- Notes:
  - Codex Desktop 未调用 Browser/IAB/Chrome/Computer Use
  - Codex 无渲染层验收；真实点击、控制台、1280/390 视口仍需 Cursor 或人工浏览器按补验清单执行
  - 本机 doctor 提示 SQLite native binding 不可用，本轮脚本运行走文件存储兜底；server tests 仍覆盖数据库行为

## [TASK-2026-07-05-full-usability-fix]

- Date: 2026-07-05
- Type: feature/fix/test
- Summary: 按“全站真实可用性修复实施计划”分 WS-0 到 WS-5 收口：移除登录/注册后的访客数据自动合并，登出清身份缓存但保留 UI 偏好；账户抽屉补齐登录态主入口、退出/切换账号、安全与更多数据能力；实时助手搜索和提词卡生成增加硬预算，移除单独搜索总结模型调用，提词卡重排并去重证据；新增 owner-scoped live cue session，多轮提词卡返回 `sessionId/history` 并在前端展示历史；模拟面试配置弹窗移除假题数/计时输入；首页改为不跳页的对话式岗位 intake；岗位标题/公司优先使用 confirmed fields；简历/资料上传增加解析中状态，简历 AI 建议改为普通文本排版。收口时修复 acceptance 中提词卡真实模型路径偶发 12 秒超时问题：DeepSeek 结构化调用启用 JSON mode，避免 JSON 修复重试拖过预算。
- Files:
  - `src/lib/store.ts`
  - `src/lib/auth.ts`
  - `src/components/auth/AuthPage.tsx`
  - `src/components/records.tsx`
  - `src/App.tsx`
  - `server/search.ts`
  - `server/orchestrator.ts`
  - `server/ai/provider.ts`
  - `server/db.ts`
  - `server/types.ts`
  - `server/index.ts`
  - `server/migrations/001_init.sql`
  - `server/migrations/003_user_id.sql`
  - `server/prompts/registry.ts`
  - `src/lib/apiClient.ts`
  - `src/lib/interviewEngine.ts`
  - `src/components/shared.tsx`
  - `src/components/live.tsx`
  - `src/components/positions.tsx`
  - `src/components/resume.tsx`
  - `src/components/questions.tsx`
  - `src/styles.css`
  - `server/index.test.ts`
  - `server/ai/provider.test.ts`
  - `server/search.test.ts`
  - `src/App.test.tsx`
  - `src/lib/store.test.ts`
  - `src/lib/interviewEngine.test.ts`
  - `src/components/shared.test.tsx`
  - `src/components/positions.test.tsx`
  - `src/components/resume.test.tsx`
  - `src/components/questions.test.tsx`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/task-history.md`
- Verified:
  - `npm.cmd run test:ai-success-smoke`：DeepSeek `cueCard/mockAnswer/resumeAi` 均为 `success`
  - `npm.cmd run verify`：lint 0 error / 15 warnings，server typecheck 通过，18 test files / 118 tests passed，build 成功
  - `npm.cmd run test:acceptance`：app 46 tests、server 40 tests、full-flow、真实 DeepSeek smoke 全通过
- Notes:
  - Codex Desktop 未调用 Browser/IAB/Chrome/Computer Use
  - Codex 无渲染层验收；首页、实时助手、模拟面试、简历上传等视觉与点击路径仍需 Cursor 或人工浏览器补验
  - full-flow 中 `cueCard/mock = fallback` 是离线脚本前提；同轮 `test:ai-success-smoke` 已验证真实模型成功路径

## [TASK-2026-07-05-ai-voice-closure]

- Date: 2026-07-05
- Type: feature/fix/test
- Summary: 按已确认的“AI 语音收口优化计划”完成实时助手与模拟面试主线体验收口：AI 额度改为按功能分组计数并保持旧字段兼容；`QUOTA_EXCEEDED` 不再被前端吞成通用服务失败；提词卡 SSE 阶段事件进入前端可见进度并支持取消，取消/失败保留本地练习卡；实时助手自动生成增加同一 final 文本去重；模拟面试语音作答按 `interim/final/editable` 分层，停止听取不清空；回答提交时明确显示模型面试官思考中与本地 fallback 状态。
- Files:
  - `server/domains/quota/quota.service.ts`
  - `server/index.ts`
  - `server/index.test.ts`
  - `src/lib/apiClient.ts`
  - `src/lib/requestError.ts`
  - `src/components/live.tsx`
  - `src/components/shared.tsx`
  - `src/components/shared/QuotaBadge.tsx`
  - `src/components/account/AccountPage.tsx`
  - `src/App.test.tsx`
  - `src/styles.css`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/task-history.md`
- Verified:
  - `node node_modules/vitest/vitest.mjs run server/index.test.ts -t "quota" --configLoader runner`：2 tests passed
  - `node node_modules/vitest/vitest.mjs run src/App.test.tsx -t "auto-generates|quota exhaustion|mock answer speech|mock interview flow" --configLoader runner`：4 tests passed
  - `npm run build`：TypeScript build 与 Vite build 通过
  - `npm run verify`：lint 0 error / 15 warnings，server typecheck 通过，16 test files / 103 tests passed，build 成功
- Notes:
  - 本轮不新增账号、邮箱、微信、支付、监控或合规实现
  - 不做 DeepSeek token 级真流式；当前是 SSE 阶段进度可见化
  - Codex 无渲染层验收；UI 仍建议 Cursor 或人工浏览器补走实时助手与模拟面试冒烟

## [TASK-2026-07-04-launch-blockers-clearance]

- Date: 2026-07-04
- Type: fix/test/deploy-hardening
- Summary: 清除上线前阻塞项：生产启动支持 `PORT` 与 `0.0.0.0`，Docker 排除本地 env 密钥并显式设置生产 host；无 `x-guest-id` 的访客改由服务端 HttpOnly cookie 兜底，避免共享访客桶；RAG 文档 id 与唯一约束改为 owner-scoped，修复多用户简历索引互相覆盖；删除被 Git 跟踪的 `.data/mail-outbox.json` 并将测试 outbox 改到临时目录；full-flow 脚本补 cookie jar 与硬断言，防止接口语义坏掉但脚本仍 0 退出。
- Files:
  - `server/index.ts`
  - `server/security.ts`
  - `server/db.ts`
  - `server/rag.ts`
  - `server/domains/quota/quota.service.ts`
  - `server/migrations/001_init.sql`
  - `server/index.test.ts`
  - `scripts/full-flow-retest.ts`
  - `Dockerfile`
  - `.dockerignore`
  - `.gitignore`
  - `.env.example`
  - `README.md`
  - `.data/mail-outbox.json`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/task-history.md`
- Verified:
  - `npm.cmd run test:server`：36 tests passed
  - `npm.cmd run test:full-flow`：intake/profile/materials/questions/cueCard/mock/resumeAi/search 全链路通过，重启后 state/export 均保持 1
  - `npm.cmd run verify`：lint 0 error / 15 warnings，server typecheck 通过，16 test files / 100 tests passed，build 成功
  - `npm.cmd run test:acceptance`：app 37、server 36、full-flow、真实 DeepSeek smoke 全通过
- Notes:
  - 账号密码方案保持最简现状，本轮不继续扩展邮箱/验证码能力
  - Codex 无渲染层验收；仍需 Cursor 或人工浏览器跑 UI 冒烟
  - `JWT_SECRET` 未配置时仍按既有策略警告；正式部署必须注入独立密钥

## [TASK-2026-07-04-prelaunch-ai-visibility-route-closure-security]

- Date: 2026-07-04
- Type: fix/test/security-review
- Summary: 按“上线前双段收口计划”完成 AI 真实状态透明化、关键静默失败提示、`/records/:id` 分享路由保留、`/mock/positions` 兼容收口，并补做上线前安全审查。前端现在会明确区分模型成功 / 后端 fallback / 真实失败原因；`App` 内关键保存与同步失败不再静默；开发态 `/api/mail/outbox` 收紧为仅返回当前登录用户自己的邮件记录；服务端在缺少 `DEEPSEEK_API_KEY` 与 `JWT_SECRET` 时都会输出明确警告。`codex-security` 插件扫描因本机 Python helper 启动失败未能跑通，本轮安全结论来自人工代码审查 + 回归测试证据。
- Files:
  - `src/App.tsx`
  - `src/App.test.tsx`
  - `src/components/live.tsx`
  - `src/components/resume.tsx`
  - `src/components/shared.tsx`
  - `src/components/positions.tsx`
  - `src/styles.css`
  - `src/lib/requestError.ts`
  - `server/index.ts`
  - `server/index.test.ts`
  - `server/ai/provider.ts`
  - `server/ai/provider.test.ts`
  - `server/domains/auth/auth.service.ts`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/task-history.md`
- Verified:
  - `npm run verify`
  - `npm run test:ai-success-smoke`
  - `npm run test:first-user`
  - `npm run test:acceptance`
- Notes:
  - `test:first-user` 中的 `cueCard/mockAnswer = fallback` 仍是脚本前提，不等于真实 DeepSeek 挂掉；同轮 `test:ai-success-smoke` 三条真实链路仍为 success
  - `test:full-flow` 中的 `fallback/401/404` 仍来自离线脚本前提与显式 `LocalFallbackProvider`，不是本轮回归
  - Codex 无渲染层验收；本轮仍需用户在真实浏览器或 Cursor 补一轮人工点击复核
  - 已知未处理限制保留：忘记密码 / 验证邮箱仍只写本地 outbox，不会真实发信

## [TASK-2026-06-29-launch-closeout-loop-and-eval]

- Date: 2026-06-29
- Type: feature/fix/test
- Summary: 上线收口版（C 端闭环）。在“尽量不加新功能”前提下查缺补漏：A1 法务/关于/帮助页路由与入口（注册同意、页脚、账户页链接）可达；A2 新增全局 Toast，apiFetch 网络失败统一提示；A3 修复游客数据隔离（按会话级 x-guest-id 隔离 ownerKey 与数据分区，含 RAG）；A4 DeepSeek 调用加 45s 超时 + 一次指数退避重试；A5 提词卡加 👍/👎 复用 /api/feedback 采集认可度。并用真实 DeepSeek key + 测试用材料做了首次用户全流程与 AI/语音评估打分。
- Files:
  - server/ai/provider.ts, server/ai/provider.test.ts
  - server/security.ts, server/index.ts, server/index.test.ts
  - src/lib/authClient.ts, src/lib/router.ts, src/lib/toast.ts
  - src/components/legal/LegalPage.tsx, src/components/auth/AuthPage.tsx, src/components/account/AccountPage.tsx
  - src/components/appShell.tsx, src/components/interactiveCueCard.tsx
  - src/components/system/ToastHost.tsx, src/components/system/ToastHost.test.tsx
  - src/App.tsx, src/App.test.tsx, src/styles.css
  - docs/reports/上线收口-首次用户全流程测试报告.md
  - docs/reports/AI与语音评估打分报告.md
  - ~/.claude/CLAUDE.md, ~/.claude/AGENTS.md（全局规则：不确定必问 + 中文输出）
- Verified:
  - npm run verify 全过（lint/typecheck/test/build；新增 provider 超时重试、游客隔离、法务路由、Toast 测试）
  - test:ai-success-smoke：cue-card/mock/resume 在线全 success
  - full-ai-eval：11/13 pass，平均 74/100，JSON 解析 100%，fallback 0%
  - full-verify-ai-voice-rag：29/32（3 项为未登录游客限制，非回归）
- Notes:
  - Codex 无渲染层验收；本轮接口/脚本级验收，未自动弹浏览器
  - 已知项：cue-card 延迟 14–16s（reasoning 模型）、证据接地 invalid、相关性评估口径偏粗，均记录待后续
  - 部分前端文件（App.tsx/appShell.tsx/styles.css/App.test.tsx）在本会话前已有未提交改动，本轮提交一并包含

## [TASK-2026-06-26-plain-language-confirmation-rule]

## [TASK-2026-06-27-home-resume-ui-and-auth-fix]

- Date: 2026-06-27
- Type: feature/fix
- Summary: 按已确认方案完成首页、侧栏、简历页与登录入口收口：首页改为中轴大输入框加下沉岗位区，资料库补显式下拉箭头与开合状态，简历页收口为 6 个正式模块加“补充内容”并改成中间文档流 + 右侧正常 AI 对话，同时修复游客侧栏“登录 / 注册”点击无反应问题，并补齐对应回归测试。
- Files:
  - `src/App.tsx`
  - `src/App.test.tsx`
  - `src/components/appShell.tsx`
  - `src/components/positions.tsx`
  - `src/components/positions.test.tsx`
  - `src/components/resume.tsx`
  - `src/components/resume.test.tsx`
  - `src/components/shared.tsx`
  - `src/styles.css`
- Verified:
  - `npm run verify`
- Notes:
  - Codex 无渲染层验收；本轮以 lint/typecheck/Vitest/build 作为交付证据
  - `lint` 仍保留既有 `react-refresh/only-export-components` warnings

## [TASK-2026-06-26-plain-language-confirmation-rule]

- Date: 2026-06-26
- Type: process
- Summary: 按用户要求，将“大幅度改动或与已有内容冲突时，必须用通俗易懂的非技术语言先问用户确认”的规则写入项目 `AGENTS.md`、项目执行规则、项目记忆、全局 agent master、Claude/Codex 全局入口。
- Files:
  - `AGENTS.md`
  - `.github/agent/memory/RULES.md`
  - `.github/agent/memory/project-memory.md`
  - `C:\Users\win\.ai-workspace\memory\global-agent-master.md`
  - `C:\Users\win\.claude\AGENTS.md`
  - `C:\Users\win\.codex\AGENTS.md`
- Verified:
  - 文本检查确认规则已写入上述本地规则文件
- Notes:
  - 这是流程规则更新，不涉及产品代码和运行时行为

## [TASK-2026-06-26-prompt-g-product-polish]

- Date: 2026-06-26
- Type: feature/fix
- Summary: 按 Prompt G 补完计划完成“先稳再美”收口：修复 mock answer 因 FTS5 查询非法字符导致的 500 与 Windows 测试资源释放问题，新增 `InterviewRecord.questionResults` 可选兼容字段与派生写入，补齐 CI 主链路；同时把 G1-G4 UI 接到首页、导航、模拟配置和 `/resume` 主简历页，并收敛记录页筛选空态。
- Files:
  - `server/db.ts`
  - `server/index.test.ts`
  - `server/orchestrator.ts`
  - `src/types.ts`
  - `src/App.tsx`
  - `src/components/appShell.tsx`
  - `src/components/positions.tsx`
  - `src/components/resume.tsx`
  - `src/components/records.tsx`
  - `src/lib/store.ts`
  - `src/lib/copy.ts`
  - `src/styles.css`
  - `.github/workflows/ci.yml`
- Verified:
  - `npm run test:server`：27 tests passed
  - `npm run test:app`：5 test files / 32 tests passed
  - `npm run verify`：lint/typecheck/test/build 全链路通过，14 test files / 81 tests passed
- Notes:
  - Codex 无渲染层验收；未调用 Browser/IAB/Chrome/Computer Use
  - `lint` 仍保留既有 `react-refresh/only-export-components` warnings，build 仍保留 Vite chunk size warning
  - 本轮 `questionResults` 仅做可选字段与派生数据，不做 schema 级迁移

## [TASK-2026-06-24-disaster-iteration-recovery]

- Date: 2026-06-24
- Type: fix
- Summary: 按“灾难迭代整顿计划”恢复七主导航与多页面主线，修复岗位抽屉误降级资料库/简历、修正 mock 进入链路的双重配置页，并根治后端 mock answer 因 FTS5 查询污染导致的 500。
- Files:
  - `src/App.tsx`
  - `src/components/jobs.tsx`
  - `src/components/live.tsx`
  - `src/components/mock-setup.tsx`
  - `src/components/questions.tsx`
  - `server/db.ts`
  - `server/index.ts`
  - `server/orchestrator.ts`
- Verified:
  - `npm run lint`
  - `npm run typecheck:server`
  - `npm test`
  - `npm run build`
  - `npm run verify`
- Notes:
  - Codex 无渲染层验收，本轮以 `verify`、Vitest 和 Fastify inject 接口链路为验收证据
  - `server/index.test.ts` 两条 mock 主链路已恢复通过
  - `lint` 仍保留既有 `react-refresh/only-export-components` warnings，无新增 error

## [TASK-2026-06-24-startup-cache-compat-fix]

- Date: 2026-06-24
- Type: fix
- Summary: 修复真实浏览器启动即进入异常页的问题。根因是前端读取旧版 `serverSnapshotCache` 后，`normalizePosition()` 未把岗位对象补齐到完整新结构，导致 `repairAppState()` 访问缺失的 `job/report/answers` 时直接抛错并落入根 `ErrorBoundary`。
- Files:
  - `src/lib/interviewEngine.ts`
  - `src/App.test.tsx`
- Verified:
  - 旧缓存最小复现脚本：`loadServerSnapshotCache()` 不再抛错
  - `node node_modules/vitest/vitest.mjs run src/App.test.tsx -t "survives startup when browser cache still contains an old app snapshot" --reporter=verbose`
  - `npm run verify`
- Notes:
  - 这是“真实本地缓存兼容性”问题，不是后端 500，也不是路由本身跳错
  - 结论来自本地复现脚本与新增回归测试，不依赖浏览器插件

## [TASK-2026-06-19-public-mvp-closeout]

- Date: 2026-06-19
- Type: feature
- Summary: 按“公开 MVP 收口整改计划”重构首页真实 JD intake、后端主导数据流、问题库资料底座、简历页标准 AI 对话、桌面侧栏展开记忆，并补齐当前文档体系与项目记忆。
- Files:
  - `src/App.tsx`
  - `src/components/appShell.tsx`
  - `src/components/home.tsx`
  - `src/components/questions.tsx`
  - `src/components/resume.tsx`
  - `src/lib/apiClient.ts`
  - `src/lib/interviewEngine.ts`
  - `src/lib/store.ts`
  - `server/index.ts`
  - `server/orchestrator.ts`
  - `src/styles.css`
  - `README.md`
  - `docs/current/*`
  - `docs/archive/*`
  - `.github/agent/memory/*`
- Notes:
  - 停止把首页当“岗位草稿生成器”
  - 停止把前端本地 `AppState` 当持久化真源
  - 文档口径已统一到“当前真实能力”

## [TASK-2026-06-19-startup-stability-closeout]

- Date: 2026-06-19
- Summary: 完成公开 MVP 本地启动收尾，修复 `一键启动.cmd` 成功即关窗导致的“像闪退”体验，并修复 `scripts/launch-experience.ps1` 在服务已运行时因日志文件占用误报失败的问题；确认本地前端 `http://127.0.0.1:5173/` 与后端健康检查 `http://127.0.0.1:8787/api/health` 可访问。
- Files:
  - `一键启动.cmd`
  - `scripts/launch-experience.ps1`
  - `README.md`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
- Verified:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\launch-experience.ps1`
  - `http://127.0.0.1:5173/`
  - `http://127.0.0.1:8787/api/health`

## [TASK-2026-06-19-public-mvp-architecture-docs]

- Date: 2026-06-19
- Type: docs
- Summary: 按“公开 MVP 技术架构与功能开发设计方案”补齐开发前文档，新增总体技术架构、接口与数据契约、功能开发设计三份现行文档，并同步更新 README 与项目记忆入口。
- Files:
  - `docs/current/公开MVP总体技术架构方案.md`
  - `docs/current/公开MVP接口与数据契约.md`
  - `docs/current/公开MVP功能开发设计方案.md`
  - `README.md`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/task-history.md`
- Notes:
  - 当前阶段先完成开发前方案，不直接进入实现
  - 技术方案以单机单用户、本地优先、SQLite FTS5 RAG 为准

## [TASK-2026-06-19-public-mvp-p0-runtime-closure]

- Date: 2026-06-19
- Type: feature
- Summary: 按“公开 MVP 功能闭环实现计划”完成 P0 运行时闭环，实现本地 SQLite FTS5 RAG、统一 AI 元数据、条件搜索、简历页真实后端 AI 对话，并让实时助手、模拟面试、记录回流接入同一套后端能力。
- Files:
  - `server/types.ts`
  - `server/migrations/001_init.sql`
  - `server/db.ts`
  - `server/rag.ts`
  - `server/orchestrator.ts`
  - `server/index.ts`
  - `server/index.test.ts`
  - `src/lib/apiClient.ts`
  - `src/components/shared.tsx`
  - `src/components/resume.tsx`
- Verified:
  - `npm run verify`
- Notes:
  - `verify` 通过，但 `src/components/shared.tsx` 仍保留既有 `react-refresh/only-export-components` warnings，当前未额外重构
  - 文件兜底存储已兼容新增 RAG 结构，避免 SQLite 不可用时直接断链

## [TASK-2026-06-20-skill-visibility-and-plan-audit]

- Date: 2026-06-20
- Type: chore
- Summary: 审计本机已安装 skill、当前 Codex 会话实际暴露 skill、项目 AGENTS 中的 skill 引用与上轮 5 步计划执行记录，修正项目内失效 skill 引用的可见性映射，并补齐上轮计划状态。
- Files:
  - `AGENTS.md`
  - `.github/agent/memory/project-memory.md`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/task-history.md`
- Notes:
  - 发现本机磁盘 skill 数量与当前会话暴露 skill 集合存在平台层筛选差异
  - 发现上轮实现已完成，但 `update_plan` 未及时同步为 completed，已补齐

## [TASK-2026-06-20-codex-browser-stability-guard]

- Date: 2026-06-20
- Type: fix
- Summary: 根治 Codex Desktop 在 Windows 上调用 IAB Browser 导致闪退：全局关闭 browser/chrome/computer-use/build-web-apps 插件，清空 browser backends，更新 AGENTS 分流 Cursor/Codex 验收，并新增可重复执行的稳定性守卫脚本。

## 2026-07-07 Codex 浏览器闪退复盘修正
- Summary: 上一条“全局关闭浏览器插件”的方案已废弃。当前正确策略是保留 Browser / Chrome / Computer Use / build-web-apps 插件启用，但 `~/.codex/config.toml` 固定 `BROWSER_USE_AVAILABLE_BACKENDS="chrome"`，`js_repl=true`；项目规则允许启动脚本自动打开系统 Chrome / Edge，禁止直接 import `openai-bundled/browser/**/browser-client.mjs`、调用 `setupBrowserRuntime` 或走 Codex in-app Browser/IAB。
- Verification: 旧 `node_repl.exe` 进程需要在配置修改后终止重启，否则旧环境仍可能继续触发 IAB。
- Files:
  - `~/.codex/config.toml`
  - `AGENTS.md`
  - `scripts/ensure-codex-browser-stability.py`
  - `scripts/ensure-codex-browser-stability.ps1`
  - `.github/agent/memory/decisions-log.md`
  - `.github/agent/memory/project-memory.md`
- Verified:
  - `npm run verify` PASS
  - `~/.codex/config.toml` 插件 enabled=false 已确认
