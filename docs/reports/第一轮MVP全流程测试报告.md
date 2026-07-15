# 第一轮 MVP 全流程测试报告

## 1. 执行口径

- 测试日期：2026-06-20
- 测试环境：Codex Desktop（禁止 Browser / IAB / Playwright / Chrome 插件）
- 验收方式：
  - `npm run verify`
  - Vitest
  - Fastify `inject`
  - 真实样本导入
  - 真实 DeepSeek 模型回归
  - 代码审查
- 不包含：
  - 浏览器渲染层真实点击验收
  - `/api/search` 联网搜索成功态验收

## 2. 本轮覆盖范围

### 2.1 已执行的验证命令

```bash
npm run verify
node node_modules/tsx/dist/cli.mjs scripts/full-flow-retest.ts
```

另执行了基于临时环境变量的真实模型回归：

- `DEEPSEEK_MODEL=deepseek-v4-flash`
- `DEEPSEEK_API_KEY` 仅注入当前进程，未写入 `.env`

### 2.2 已覆盖的主流程

1. 首页 `JD intake`
2. 简历导入与 profile 更新
3. 问题库项目资料 / 上传资料 / 手动问题沉淀
4. 实时助手提词卡 SSE
5. 模拟面试 session 创建、回答、追问、报告
6. 简历 AI 区块优化 / 整份优化 / 岗位匹配分析
7. 记录保存、导出、服务重启后回显、再导入
8. 语音识别 `interim / final / editable`
9. fallback 展示与本地练习模式显式提示

## 3. 关键结果摘要

## 3.1 自动化基线

- `npm run verify`：通过
- `lint`：通过，但存在 14 条 `react-refresh/only-export-components` warning
- `typecheck:server`：通过
- `test`：11 个测试文件、40 个测试全部通过
- `build`：通过，但 Vite 输出存在多个 `500 kB+` chunk 警告

## 3.2 真实样本全链路回归

通过 `scripts/full-flow-retest.ts` 的真实样本执行结果：

- PDF 简历导入：通过
- DOCX 项目资料导入：通过
- `/api/positions/intake`：200
- `/api/profile`：200
- `/api/positions/:id/materials`：200
- `/api/positions/:id/questions`：200
- `/api/copilot/cue-card/stream`：200
- `/api/mock/session`：200
- `/api/mock/session/:id/answer`：200
- `/api/resume/ai`：200
- `/api/records`：200
- `/api/export` / `/api/import`：通过
- 服务重启后记录回显：一致

## 3.3 AI 成功态 / 降级态拆分

### 真实模型成功态已验证

- `/api/copilot/cue-card/stream`
  - 连续 3 次复验均返回 `event: card`
  - `meta.backendStatus = success`
- `/api/mock/session/:id/answer`
  - `meta.backendStatus = success`
- `/api/resume/ai`
  - `meta.backendStatus = success`

### fallback / disabled 已验证

- 未配置 `DEEPSEEK_API_KEY` 时：
  - `cue-card`、`mock answer`、`resume/ai` 均能回退到本地练习模式
- 未配置 `SEARCH_PROVIDER / SEARCH_API_KEY` 时：
  - `/api/search` 返回 `provider = disabled`
  - 文案明确提示仅使用本地简历、JD 与问题库上下文

### 未验证成功态

- `/api/search` 联网搜索成功态
  - 当前实现只支持 `tavily | bing | serpapi`
  - 不能把 DeepSeek 模型内建联网能力算作现有 `/api/search` 已验证

## 4. 交互与数据流专项结论

## 4.1 语音与实时交互

- `interim / final / editable`：已在前端测试与代码中覆盖
- 停止听取不清空已识别文本：已覆盖
- 手动确认 / 自动生成双模式：已覆盖
- 语音不支持时降级到文本输入：已覆盖

对应实现：

- [src/components/live.tsx](C:/Users/Windows11/Desktop/辅助面试/src/components/live.tsx)
- [src/lib/speech.ts](C:/Users/Windows11/Desktop/辅助面试/src/lib/speech.ts)
- [src/App.test.tsx](C:/Users/Windows11/Desktop/辅助面试/src/App.test.tsx)

## 4.2 页面跳转主线

已从代码和测试确认以下主路径存在：

1. 首页保存岗位后进入模拟配置
2. 首页可切换岗位继续准备
3. 记录页可跳转到问题库 / 简历 / JD 分析
4. 侧栏在桌面模式下保持展开状态

对应实现：

- [src/App.tsx](C:/Users/Windows11/Desktop/辅助面试/src/App.tsx)
- [src/components/home.tsx](C:/Users/Windows11/Desktop/辅助面试/src/components/home.tsx)
- [src/components/records.tsx](C:/Users/Windows11/Desktop/辅助面试/src/components/records.tsx)

## 4.3 数据流转一致性

已验证一致的部分：

- 记录保存后 `state / records / export` 一致
- 服务重启后记录仍可读
- 真实样本导入后可进入后续问题、提词卡、模拟、简历 AI 链路

存在风险的部分见“问题清单”。

## 5. 问题清单

以下按严重级别排序。

### P1 - 账户导入会吞掉服务端失败并仍提示成功

- 模块：记录 / 服务端
- 复现路径：
  1. 在账户面板导入一份备份
  2. `importToServer` 失败时前端仍继续走本地成功提示
- 期望行为：
  - 服务端导入失败时应明确报错，不应显示“已导入备份”
- 实际行为：
  - 代码在 [src/components/records.tsx](C:/Users/Windows11/Desktop/辅助面试/src/components/records.tsx:345) 对 `importToServer(imported)` 直接 `.catch(() => undefined)`
  - 随后在同文件 [347](C:/Users/Windows11/Desktop/辅助面试/src/components/records.tsx:347) 无条件提示“已导入备份。”
- 影响范围：
  - 前端本地状态与后端持久化状态可能分叉
  - 用户误以为导入成功，后续刷新或重启后数据可能丢失
- 是否已有自动化覆盖：否
- 建议修复方向：
  - 导入应以服务端结果为准
  - `importToServer` 失败时中止成功提示，并展示错误状态

### P1 - fallback 提词卡存在鼓励“按 JD 虚构场景”的风险

- 模块：实时助手 / AI 对话
- 复现路径：
  1. 使用证据不足的简历上下文生成真实模型提词卡
  2. 查看返回的 `strategy` / `bullets`
- 期望行为：
  - 无真实经历时应明确提示“不要编造”，只允许基于已有经历做迁移表达
- 实际行为：
  - 真实模型返回内容中出现“可基于 JD 虚构一个合理场景”的指导
  - 这与提示词 guardrail “不编造事实”存在冲突
- 影响范围：
  - 面试准备建议可能引导用户越过真实性边界
  - 影响产品可信度
- 是否已有自动化覆盖：否
- 代码证据：
  - guardrail 定义在 [server/prompts/registry.ts](C:/Users/Windows11/Desktop/辅助面试/server/prompts/registry.ts:48) 与 [52](C:/Users/Windows11/Desktop/辅助面试/server/prompts/registry.ts:52)
- 建议修复方向：
  - 收紧 `cue-card` system prompt 和输出后处理
  - 对“假设 / 虚构 / 编造”类措辞做拦截或重写

### P2 - fallback 证据会统一退化为 `ev-fallback`，导致证据命中可信度偏低

- 模块：实时助手 / 模拟面试 / 简历 AI / 服务端
- 复现路径：
  1. 使用证据稀薄简历进入提词卡或面试问答
  2. 查看 `evidenceIds` 与证据追踪
- 期望行为：
  - 在证据不足时应显式标注“证据不足”，避免把兜底数据伪装成真实证据命中
- 实际行为：
  - [src/lib/interviewEngine.ts](C:/Users/Windows11/Desktop/辅助面试/src/lib/interviewEngine.ts:590) 的 `fallbackEvidence` 会生成固定 `ev-fallback`
  - [593](C:/Users/Windows11/Desktop/辅助面试/src/lib/interviewEngine.ts:593) 写死 `id: "ev-fallback"`
  - [598](C:/Users/Windows11/Desktop/辅助面试/src/lib/interviewEngine.ts:598) 用“需要补充可验证结果”兜底
- 影响范围：
  - 证据命中展示、提词卡引用、问题沉淀的可信度下降
- 是否已有自动化覆盖：部分覆盖 fallback，但未校验可信度语义
- 建议修复方向：
  - 将 fallback 证据与真实证据分级展示
  - UI 层对 fallback 证据加醒目标记

### P2 - `scripts/full-flow-retest.ts` 直接用 `node` 无法运行，测试资产存在误用风险

- 模块：测试资产
- 复现路径：
  1. 执行 `node scripts/full-flow-retest.ts`
- 期望行为：
  - 脚本有明确可执行方式，或能直接被 npm script 调起
- 实际行为：
  - 直接 `node` 运行会报 `ERR_MODULE_NOT_FOUND`
  - 需要使用 `node node_modules/tsx/dist/cli.mjs scripts/full-flow-retest.ts`
- 影响范围：
  - 测试人员容易误判脚本失效
- 是否已有自动化覆盖：否
- 建议修复方向：
  - 在 `package.json` 增加脚本入口，例如 `test:full-flow`
  - 在 README / docs 中写明运行方式

### P2 - 构建产物 chunk 过大，首屏与导入相关体验存在性能风险

- 模块：前端 / 构建
- 复现路径：
  1. 执行 `npm run build`
- 期望行为：
  - 关键 chunk 控制在合理范围，至少对大依赖做分包评估
- 实际行为：
  - 构建输出存在多个 `500 kB+` chunk 警告
- 影响范围：
  - 首屏加载
  - 简历导入相关页面资源体积
- 是否已有自动化覆盖：仅构建警告，无性能门禁
- 建议修复方向：
  - 优先评估 `pdfjs-dist`、`mammoth`、大页面组件的拆包

### P3 - Lint 仍保留 14 条 Fast Refresh warning，交付信号不够干净

- 模块：前端 / 工程质量
- 复现路径：
  1. 执行 `npm run verify`
- 期望行为：
  - 核心交付前 warning 尽量清零，至少不要长期挂在 verify 输出里
- 实际行为：
  - `resume.tsx`、`shared.tsx` 等文件存在 `react-refresh/only-export-components` warning
- 影响范围：
  - 开发体验
  - 交付信号噪音
- 是否已有自动化覆盖：有
- 建议修复方向：
  - 将共享常量/函数拆离组件文件

## 6. 已验证成功链路

- 首页 `JD intake` 保存岗位
- 真实样本 PDF / DOCX 导入
- 问题库资料与问题保存
- `cue-card` SSE 提词卡生成
- 模拟面试后端 session / answer / follow-up
- 简历 AI 区块优化 / 整份优化 / 匹配分析
- 记录保存
- 导出 / 导入 round-trip
- 服务重启后的记录回显
- 真实模型 `success`：
  - `cue-card`
  - `mock answer`
  - `resume/ai`

## 7. 未验证项与原因

### 7.1 `/api/search` 成功态

- 原因：当前未提供 `SEARCH_PROVIDER / SEARCH_API_KEY`
- 备注：不能用 DeepSeek 自带联网替代现有搜索实现

### 7.2 渲染层 UI 冒烟

- 原因：Codex Desktop 禁止浏览器 / IAB / Playwright 页面验收
- 备注：本轮仅完成代码与自动化层审查

## 8. 渲染层待补验项

需在 Cursor 或人工浏览器补验：

1. `1280x720` 首页首屏是否符合“主标题 + 输入框 + 岗位卡 + CTA + 最小右侧上下文”
2. `1280x720` 模拟面试页是否存在无意义空白或控件挤压
3. `390px` 移动端导航、题词卡、输入框是否重叠或横向溢出
4. 实时助手语音按钮、文本回填、提词卡区域在真实浏览器中的视觉状态
5. 记录页时间轴、Transcript 展开、指标卡排版
6. 简历页三栏布局在窄桌面宽度下的可读性
7. 控制台是否存在浏览器运行时 error

## 9. 结论

本轮可确认：

- MVP 的核心业务链路在自动化和接口层面基本跑通
- fallback 路径清晰、持久化链路基本可靠
- 三条主要 AI 主链在真实模型下已能进入 `success`

本轮不能确认：

- 浏览器渲染层最终体验
- 联网搜索成功态

当前最值得优先进入修复/加固的事项：

1. 导入成功提示与服务端真实状态不一致
2. 提词卡在真实性 guardrail 上仍有“鼓励虚构”的风险
3. fallback 证据语义不够清晰
4. 全流程测试脚本缺少正式运行入口
