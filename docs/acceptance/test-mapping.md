# 页面功能与测试映射

## 1. 目标

这份文档把 `全页面全功能验收矩阵` 中的每类验收项，映射到当前项目的自动化证据或人工浏览器证据，避免出现“矩阵写了，但没有真实执行入口”的空项。

原则：

- 优先复用现有 `src/App.test.tsx`、组件测试、`server/index.test.ts`、全流程脚本。
- 只有自动化无法稳定证明的渲染层问题，才归到人工浏览器验收。
- Codex 只执行代码 / 接口 / 脚本层验证，不承担渲染层结论。

## 2. 自动化映射总览

| 验收范围 | 主要证据 | 覆盖内容 |
| --- | --- | --- |
| 路由页可达性、主按钮、主跳转、游客拦截 | `src/App.test.tsx` | 首页、岗位详情/对话、实时助手、模拟链路、JD、问题、简历、记录、认证页、法务页、状态页 |
| 岗位页局部行为 | `src/components/positions.test.tsx` | 岗位卡、详情页动作、完善对话、模拟岗位选择、模拟配置 |
| 问题记录页局部行为 | `src/components/questions.test.tsx` | 手动记录问题、答案/笔记编辑、上传资料为辅、移除资料、无手动项目卡 |
| 面试记录页局部行为 | `src/components/records.test.tsx` | 筛选、Transcript 折叠、一键沉淀只回流“问题标题 + 简短笔记”、再次练习 |
| 简历页局部行为 | `src/components/resume.test.tsx` | 全量建议结构映射、降级建议应用 |
| 后端接口与数据链路 | `server/index.test.ts` | intake、materials/questions/preferences、mock session、complete、删除级联、auth、onboarding |
| 跨页主链路与数据持久化 | `scripts/full-flow-retest.ts` | 建岗、完善对话保存、资料/问题写入、提词卡、模拟、记录保存、重启持久化、导入导出 |
| AI 在线成功链路 | `scripts/ai-success-smoke.ts` | cue-card / mock answer / resume AI 的真实模型 success |
| 渲染层、分辨率、控制台 | 人工浏览器 / Cursor | `1280x720`、`390px`、控制台无 error、文案对齐方案 |

## 3. 页面到测试的逐项映射

### 首页 `/`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 首页首屏结构 | `src/App.test.tsx` | 断言主导航、标题、主输入、CTA 存在 |
| 创建岗位后进入完善对话 | `src/App.test.tsx` | 断言提交后进入 `/positions/:id/conversation` |
| 岗位卡跳转详情 | `src/App.test.tsx`, `src/components/positions.test.tsx` | 断言点击岗位卡行为 |
| 实时助手入口 | `src/App.test.tsx` | 已登录直达、未登录拦截 |
| 模拟面试入口 | `src/App.test.tsx` | 已登录进入 `/mock/positions`；未登录拦截 |
| 游客提示文案 | `src/App.test.tsx` | 断言“页面可以先看...” 文案存在 |

### 岗位详情 `/positions/:id`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 详情页内容结构 | `src/App.test.tsx`, `src/components/positions.test.tsx` | 验证左右分区、岗位信息、配置摘要 |
| 去模拟配置 | `src/components/positions.test.tsx` | 行为断言 |
| 继续完善 | `src/components/positions.test.tsx` | 行为断言 |
| 删除岗位级联 | `server/index.test.ts` | 重点由服务端删除级联做硬验证 |

### 岗位完善对话 `/positions/:id/conversation`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 页面可见与消息回显 | `src/App.test.tsx`, `src/components/positions.test.tsx` | 页面结构与输入框存在 |
| 继续追问并自动保存 | `src/components/positions.test.tsx`, `scripts/full-flow-retest.ts` | 组件验证提交参数；脚本验证真实链路 |
| 主出口去模拟配置 | `src/components/positions.test.tsx` | 行为断言 |
| 次出口回详情 | `src/components/positions.test.tsx` | 行为断言 |

### 实时助手 `/live`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 手动确认 / 自动生成 | `src/App.test.tsx` | 行为断言 |
| 停止听取不清空 | `src/App.test.tsx` | Speech mock 验证 |
| 生成提词卡 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | UI 与接口链路双证据 |
| fallback 文案 | `src/App.test.tsx` | 断言本地练习模式提示 |
| 结束确认弹层 | `src/App.test.tsx` | 弹层与文案断言 |
| 游客拦截 | `src/App.test.tsx` | 断言登录弹层 |

### 模拟面试 `/mock/positions` -> `/mock/setup/:id` -> `/mock/room/:id`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 岗位选择列表 | `src/App.test.tsx`, `src/components/positions.test.tsx` | 路由级和组件级双覆盖 |
| 无岗位空态 | `src/components/positions.test.tsx` | 组件断言 |
| 配置项完整性 | `src/components/positions.test.tsx` | 不应出现题数 / 时长 |
| 配置保存 | `server/index.test.ts` | `/api/positions/:id/preferences` |
| 进入房间与首题 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | 主链路断言 |
| 提交回答与追问 | `src/App.test.tsx`, `scripts/ai-success-smoke.ts` | 本地成功链路 + 在线成功链路 |
| fallback 明示 | `src/App.test.tsx` | 断言本地练习模式 |
| 结束保存 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | 保存并跳记录页 |
| 未完成恢复 / 完成关闭 | `server/index.test.ts` | `/api/positions/:id/mock-session` + `/complete` |

### JD分析 `/jd`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 页面可见性 | `src/App.test.tsx` | 路由级断言 |
| 保存问题到问题记录 | `scripts/full-flow-retest.ts` | 主链路有问题写入 |
| 游客拦截 | `src/App.test.tsx` | 依赖全局登录拦截 |

当前缺口：

- 页内“更新 JD 后重新分析”的更细粒度 UI 行为还没有单独组件测试，目前主要由全流程与代码审查兜底。

### 问题记录 `/questions`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 页面可见性 | `src/App.test.tsx` | 路由级断言 |
| 手动记录问题 | `src/components/questions.test.tsx` | 组件断言 |
| 编辑答案 / 笔记 | `src/components/questions.test.tsx` | 组件断言 |
| 上传资料为辅 | `scripts/full-flow-retest.ts` | 真实接口链路 |
| 移除资料 | `src/components/questions.test.tsx` | 组件断言 |
| 无手动项目卡入口 | `src/components/questions.test.tsx` | 文案与入口约束 |

### 我的简历 `/resume`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 页面可见性与 AI 聊天常驻 | `src/App.test.tsx` | 路由级断言 |
| 结构化整份建议映射 | `src/components/resume.test.tsx` | 已有 |
| 本地降级建议映射 | `src/components/resume.test.tsx` | 已有 |
| 在线 success | `scripts/ai-success-smoke.ts` | 依赖模型环境 |
| 导入简历、保存与回写 | `scripts/full-flow-retest.ts` | 真实样本导入与保存 |

### 面试记录 `/records`

| 功能点 | 自动化 | 说明 |
| --- | --- | --- |
| 页面可见性与筛选 | `src/App.test.tsx`, `src/components/records.test.tsx` | 路由级和组件级覆盖 |
| 报告内容与 Transcript 折叠 | `src/components/records.test.tsx` | 组件断言 |
| 一键沉淀只回流“问题标题 + 简短笔记” | `src/components/records.test.tsx` | 核心产品规则硬断言 |
| 再次练习跳转 | `src/components/records.test.tsx` | 行为断言 |

### 认证与支撑页

| 页面 | 自动化 | 说明 |
| --- | --- | --- |
| `/auth/login` `/auth/register` | `src/App.test.tsx`, `server/index.test.ts` | 页面可见性 + 接口成功/失败 |
| `/forgot-password` `/reset-password` `/verify-email` | `src/App.test.tsx`, `server/index.test.ts` | 页面文案 + token 链路 |
| `/onboarding` | `src/App.test.tsx`, `server/index.test.ts` | UI 可达 + ready 态落地 |
| `/account` | `src/App.test.tsx`, `server/index.test.ts` | 页面可见 + 删除账号等接口 |
| `/legal/terms` `/legal/privacy` | `src/App.test.tsx` | 页面可达 |
| `/404` `/500` | `src/App.test.tsx` | 页面可达 |

## 4. 关键弹层与对话框映射

| 弹层 / 对话框 | 自动化 | 说明 |
| --- | --- | --- |
| 登录拦截弹层 | `src/App.test.tsx` | 首页关键动作触发 |
| 删除岗位确认 | 代码审查 + 人工浏览器 | 当前是 `window.confirm`，Codex 以代码审查和服务端级联删除兜底 |
| 实时助手结束确认 | `src/App.test.tsx` | 弹层与文案存在 |
| 模拟面试结束确认 | `src/App.test.tsx` | 弹层与文案存在 |
| 账户与导入导出弹层 | `src/App.test.tsx` | 导出与导入失败提示 |
| 反馈弹层 | 代码审查 + 后端接口 | 当前尚未补专门 UI 测试，需人工补一轮 |

## 5. 发布门禁映射

| 门禁项 | 证据 |
| --- | --- |
| `npm run verify` 必过 | `package.json` + 实际执行日志 |
| `npm run test:acceptance` 必过 | `package.json` + 实际执行日志 |
| `npm run verify:acceptance` 必过 | `package.json` + 实际执行日志 |
| 矩阵所有项必须有结果 | `docs/acceptance/full-page-feature-matrix.md` |
| 核心页不得存在 `Fail` 或空白 | `docs/acceptance/acceptance-run-report.md` |
| `Blocked` 必须说明外部依赖 | `docs/acceptance/acceptance-run-report.md` |

## 6. Codex 与人工浏览器分流

Codex 负责：

- `npm run verify`
- `npm run test:app`
- `npm run test:server`
- `npm run test:full-flow`
- `npm run test:ai-success-smoke`（若环境具备）
- `npm run test:acceptance`
- `npm run verify:acceptance`
- 代码审查与接口链路确认

Cursor / 人工浏览器负责：

- `1280x720` 首页、模拟间、记录页布局
- `390px` 移动端不重叠、不横向溢出
- 控制台无 error
- 删除确认、fallback、游客拦截文案与产品方案一致

## 7. 当前已知缺口

以下项已纳入矩阵，但当前仍建议继续补测或人工覆盖：

| 缺口 | 当前状态 | 建议 |
| --- | --- | --- |
| JD 页“更新分析”页内行为 | 主要依赖代码审查和主链路脚本 | 后续加 `src/components/jd.test.tsx` |
| 反馈弹层 UI 提交交互 | 主要依赖代码审查和后端接口 | 后续加 `src/App.test.tsx` 或组件测试 |
| 浏览器渲染层 | Codex 无法执行 | 由 Cursor / 人工浏览器补齐 |
| AI 在线 success 链路 | 依赖 `DEEPSEEK_API_KEY` | 环境缺失时必须标记为 `Blocked` |
