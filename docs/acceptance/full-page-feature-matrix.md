# 全页面全功能验收矩阵

说明：

- 结果字段只允许填写 `Pass / Fail / Blocked / N/A`。
- `自动化归属` 只填写已存在或本次补齐的证据入口；渲染层布局问题统一归到人工浏览器验收。
- `证据链接` 推荐填写测试文件、脚本、报告章节或人工截图/录屏地址。
- Codex 只执行代码、接口、脚本、Vitest 与 `npm run verify:acceptance`；渲染层必须标注为 `人工浏览器 / Cursor`。

| 页面 | 功能点 | 前置条件 | 操作 | 预期结果 | 异常态 | 验收方式 | 自动化归属 | 结果 | 证据链接 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` 首页 | 首页路由与首屏结构 | 应用可启动 | 进入首页 | 显示主标题、主输入、岗位卡、实时助手入口、模拟面试入口 | 页面 404 / 结构错位 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/` 首页 | 创建岗位并直达完善对话 | 已有可提交 JD 文本 | 输入岗位/JD 后提交 | 创建/更新岗位后直接进入 `/positions/:id/conversation` | 接口失败时不应静默跳错页 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/` 首页 | 已有岗位卡跳转详情页 | 至少有 1 个岗位 | 点击岗位卡 | 进入完整岗位详情页 `/positions/:id` | 错跳抽屉或错误路由 | 自动化 | `src/App.test.tsx`, `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/` 首页 | 实时助手入口 | 已登录 / 未登录两种态 | 点击“进入实时助手” | 已登录直达 `/live`；未登录弹登录拦截 | 未登录直接进入练习页 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/` 首页 | 模拟面试入口 | 已登录 / 未登录两种态 | 点击“进入模拟面试” | 已登录进入 `/mock/positions`；未登录弹登录拦截 | 未登录直接开始练习 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/positions/:id` 岗位详情 | JD / 岗位信息展示 | 已有岗位 | 打开岗位详情 | 左侧显示岗位状态、确认字段、原始 JD、准备重点 | 信息缺失或进入抽屉态 | 自动化 + 人工浏览器 | `src/App.test.tsx`, `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/positions/:id` 岗位详情 | 去模拟配置 | 已有岗位 | 点击“去模拟配置” | 进入 `/mock/setup/:id` | 错跳其它页 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/positions/:id` 岗位详情 | 继续完善入口 | 已有岗位 | 点击“继续完善对话” | 进入 `/positions/:id/conversation` | 错跳其它页 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/positions/:id` 岗位详情 | 删除岗位与级联提示 | 已有岗位及关联资产 | 点击删除并确认 | 明确提示资料与练习记录一并删除；删除后岗位、问题、资料、记录、mock session 全消失 | 未提示级联后果 / 数据残留 | 自动化 + 人工浏览器 | `src/App.tsx`, `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/positions/:id/conversation` 岗位完善对话 | 路由与历史消息展示 | 已有岗位 | 打开页面 | 展示历史消息、已确认字段、待补字段 | 空白页或消息丢失 | 自动化 | `src/App.test.tsx`, `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/positions/:id/conversation` 岗位完善对话 | 继续追问并自动保存 | 已有岗位 | 输入补充信息并提交 | 调用真实保存链路，消息进入当前岗位上下文 | 只本地显示、刷新丢失 | 自动化 + 全流程脚本 | `src/components/positions.test.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/positions/:id/conversation` 岗位完善对话 | 主出口去模拟配置 | 已有岗位 | 点击“去模拟配置” | 进入 `/mock/setup/:id` | 错路由 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/positions/:id/conversation` 岗位完善对话 | 次出口回详情 | 已有岗位 | 点击“返回岗位详情” | 回到 `/positions/:id` | 错路由 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/live` 实时助手 | 页面入口与模式切换 | 至少有 1 个岗位 | 打开页面 | 显示问题输入、手动确认、自动生成 | 页面空白 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/live` 实时助手 | 语音输入与停止不清空 | 浏览器支持语音 / 不支持语音两种态 | 开始听取、停止、编辑 | `interim/final` 可区分；停止后文本保留可编辑 | 停止后文本被清空 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/live` 实时助手 | 生成提词卡 | 已有问题文本 | 生成提词卡 | 提词卡、风险提醒、追问预测可见 | 失败无提示 | 自动化 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/live` 实时助手 | 结束确认弹层 | 已产生 transcript 或提词卡 | 点击“结束” | 弹出“结束实时助手”确认，说明保存后果 | 无确认直接结束 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/live` 实时助手 | 游客拦截 | 未登录 | 尝试生成 / 保存 | 弹登录拦截，而不是页面报错 | 未登录直接写入数据 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/mock/positions` 模拟岗位选择 | 岗位列表 | 已有岗位 | 打开页面 | 展示岗位列表，点击后进入配置页 | 无法进入配置页 | 自动化 | `src/App.test.tsx`, `src/components/positions.test.tsx` | Pass | `src/App.test.tsx` |
| `/mock/positions` 模拟岗位选择 | 无岗位空态 | 无岗位 | 打开页面 | 显示“先回首页创建岗位”空态 | 空白页 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/mock/setup/:id` 模拟配置 | 配置项完整性 | 已有岗位 | 打开页面 | 仅保留角色 / 难度 / 风格 / 性别 / 提交方式 | 出现题数 / 时长等不该保留项 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/mock/setup/:id` 模拟配置 | 保存配置并进入房间 | 已有岗位 | 修改配置并开始 | 保存配置，进入 `/mock/room/:id` | 配置不落库 | 自动化 + 接口测试 | `src/components/positions.test.tsx`, `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/mock/setup/:id` 模拟配置 | 历史练习继续提示 | 岗位已有 mockTurns | 打开页面 | 显示“有历史练习，可继续” | 误显示首次进入 | 自动化 | `src/components/positions.test.tsx` | Pass | `src/components/positions.test.tsx` |
| `/mock/room/:id` 模拟房间 | 进入房间与首题生成 | 已完成配置 | 进入房间 | 展示首题、对话区、回答框 | 首题缺失 | 自动化 + 全流程脚本 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/mock/room/:id` 模拟房间 | 生成提词卡 | 房间已打开 | 点击“生成提词卡” | 显示提词卡 | 失败无提示 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/mock/room/:id` 模拟房间 | 提交回答与追问 | 已输入回答 | 提交当前回答 | 产生追问 / 下一题与即时反馈 | 回答后无状态变化 | 自动化 + 在线冒烟 | `src/App.test.tsx`, `scripts/ai-success-smoke.ts` | Pass / Blocked | `src/App.test.tsx`, `scripts/ai-success-smoke.ts` |
| `/mock/room/:id` 模拟房间 | fallback 提示 | 模拟后端不可用 | 进入房间 | 明确显示本地练习模式，不伪装成功 | 无明确降级提示 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/mock/room/:id` 模拟房间 | 结束确认与保存 | 已有练习内容 | 点击结束并确认 | 进入面试记录页，保存 transcript / 提词卡 / 评分 | 未确认直接结束 | 自动化 + 全流程脚本 | `src/App.test.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/mock/room/:id` 模拟房间 | 未完成会话恢复 / 完成后关闭 | 已开始会话 | 查询恢复、完成关闭 | 未完成可恢复；完成后不再恢复 | 完成后仍可被恢复 | 自动化 | `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/jd` JD分析 | 页面入口与当前岗位分析 | 已有岗位 | 打开页面 | 显示 JD 文本、解析摘要、准备重点、可能问题 | 页面空白 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/jd` JD分析 | 更新 JD 重新分析 | 已有岗位 | 修改 JD 并更新 | 触发后端分析更新 | 无法提交 / 无状态变化 | 自动化 + 人工浏览器 | `src/components/jd.tsx`, `docs/acceptance/test-mapping.md` | N/A | 待补更细粒度组件测试 |
| `/jd` JD分析 | 保存问题到问题记录 | 已有分析结果 | 点击“保存为记录问题” | 生成问题条目进入当前岗位问题库 | 保存失败无提示 | 自动化 + 全流程脚本 | `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/jd` JD分析 | 游客拦截 | 未登录 | 尝试更新分析 / 保存问题 | 登录拦截明确出现 | 游客直接写入数据 | 自动化 | `src/App.tsx` 路由守卫 | Pass | `src/App.test.tsx` |
| `/questions` 问题记录 | 页面入口 | 已有岗位 | 打开页面 | 显示问题与资料沉淀页 | 页面空白 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/questions` 问题记录 | 手动记录问题 | 已登录 | 新增问题、答案、笔记 | 问题写入当前岗位 | 提交后丢失 | 自动化 | `src/components/questions.test.tsx` | Pass | `src/components/questions.test.tsx` |
| `/questions` 问题记录 | 编辑答案 / 笔记 | 已有问题 | 展开问题后编辑 | 触发保存更新 | 编辑无效 | 自动化 | `src/components/questions.test.tsx` | Pass | `src/components/questions.test.tsx` |
| `/questions` 问题记录 | 上传资料 | 已登录 | 上传 `.txt/.md/.pdf/.docx` | 文件解析为资料卡 | 失败无文案 | 自动化 + 人工浏览器 | `src/components/questions.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/questions` 问题记录 | 移除资料 | 已有上传资料 | 点击移除 | 当前岗位资料被移除 | 数据残留 | 自动化 | `src/components/questions.test.tsx` | Pass | `src/components/questions.test.tsx` |
| `/questions` 问题记录 | 无手动项目卡入口 | 打开页面 | 检查资料入口 | 仅保留上传资料能力 | 出现手动项目资料卡入口 | 自动化 | `src/components/questions.test.tsx` | Pass | `src/components/questions.test.tsx` |
| `/resume` 我的简历 | 页面入口与 AI 聊天常驻 | 已有简历 | 打开页面 | 左侧模块、中部编辑、右侧 AI 聊天同时可见 | 退回旧卡片堆叠 | 自动化 + 人工浏览器 | `src/App.test.tsx`, `src/components/resume.test.tsx` | Pass | `src/components/resume.test.tsx` |
| `/resume` 我的简历 | 上传简历 | 已登录 | 上传简历文件 | 刷新简历快照并有提示 | 上传失败无提示 | 自动化 + 人工浏览器 | `src/components/resume.tsx`, `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/resume` 我的简历 | 区块优化 / 整份优化 / 岗位匹配 | 已登录 | 触发 AI 操作 | 返回建议，可应用到编辑区 | 后端失败时无降级提示 | 自动化 + 在线冒烟 | `src/components/resume.test.tsx`, `scripts/ai-success-smoke.ts` | Pass / Blocked | `src/components/resume.test.tsx`, `scripts/ai-success-smoke.ts` |
| `/resume` 我的简历 | 保存到后端 | 已编辑区块 | 点击保存 | 证据或亮点进入后端 | 保存无反馈 | 自动化 + 全流程脚本 | `scripts/full-flow-retest.ts` | Pass | `scripts/full-flow-retest.ts` |
| `/resume` 我的简历 | 游客拦截 | 未登录 | 尝试上传 / 生成 / 保存 | 登录拦截出现 | 游客直接写入 | 自动化 | `src/App.tsx` 路由守卫 | Pass | `src/App.test.tsx` |
| `/records` 面试记录 | 页面入口与筛选 | 已有记录 | 打开并筛选模式/岗位 | 实时与模拟记录可分栏展示和筛选 | 筛选无效 | 自动化 | `src/App.test.tsx`, `src/components/records.test.tsx` | Pass | `src/components/records.test.tsx` |
| `/records` 面试记录 | 报告展示 | 已有记录 | 查看当前记录 | 展示题目时间轴、改进建议、表达指标 | 报告缺字段 | 自动化 | `src/components/records.test.tsx` | Pass | `src/components/records.test.tsx` |
| `/records` 面试记录 | Transcript 折叠 | 已有记录 | 展开 / 收起 Transcript | 默认折叠，可按需展开 | 默认展开挤占页面 | 自动化 + 人工浏览器 | `src/components/records.test.tsx` | Pass | `src/components/records.test.tsx` |
| `/records` 面试记录 | 一键沉淀到问题记录 | 已有记录 | 点击“一键沉淀到问题记录” | 只回流“问题标题 + 简短笔记” | 回流整段 transcript | 自动化 | `src/components/records.test.tsx` | Pass | `src/components/records.test.tsx` |
| `/records` 面试记录 | 再次练习跳转 | 已有记录 | 点击“再练一次” | 回到模拟练习流程 | 跳错页面 | 自动化 | `src/components/records.test.tsx` | Pass | `src/components/records.test.tsx` |
| `/auth/login` 登录 | 登录页可见性与表单校验 | 无 | 打开并提交非法手机号/密码 | 出现明确校验文案 | 无文案或崩溃 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/auth/register` 注册 | 注册页可见性与协议同意 | 无 | 打开并提交流程 | 可见注册动作，协议不同意时阻止提交 | 无协议拦截 | 自动化 + 接口测试 | `src/App.test.tsx`, `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/forgot-password` 忘记密码 | 表单与成功提示 | 无 | 输入邮箱并发送 | 成功提示邮件已发送 | 接口失败无反馈 | 自动化 + 接口测试 | `src/App.test.tsx`, `server/index.test.ts` | Pass | `src/App.test.tsx` |
| `/reset-password` 重置密码 | token 校验与成功提示 | 合法 / 非法 token | 重置密码 | 合法时成功，非法时明确无效 | token 无效仍可提交 | 自动化 + 接口测试 | `src/App.test.tsx`, `server/index.test.ts` | Pass | `src/App.test.tsx` |
| `/verify-email` 邮箱验证 | token 校验与成功提示 | 合法 / 非法 token | 验证邮箱 | 合法时 session 状态刷新，非法时提示无效 | 无提示 | 自动化 + 接口测试 | `src/App.test.tsx`, `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/onboarding` 引导页 | 路由与完成引导 | 已登录新用户 | 完成或跳过引导 | 进入 ready 态，返回主线 | 完成后仍卡在 onboarding | 自动化 + 接口测试 | `src/App.test.tsx`, `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/account` 账户页 | 页面可见性与配额 | 已登录 | 打开页面 | 显示账户信息、使用额度、通知设置、反馈与危险区 | 页面空白 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/account` 账户页 | 导出数据 | 已登录 | 导出数据 | 成功导出 JSON | 失败无反馈 | 自动化 + 人工浏览器 | `src/App.tsx`, `src/components/records.tsx`, `server/index.ts` | Pass | `src/App.test.tsx` |
| `/account` 账户页 | 删除账号 | 已登录 | 输入 `DELETE` 并删除 | 账号失效并跳回登录 | 删除后 session 仍有效 | 自动化 + 接口测试 | `server/index.test.ts` | Pass | `server/index.test.ts` |
| `/legal/terms` 法务页 | 页面可见性 | 无 | 打开页面 | 用户协议可阅读，可返回 | 404 / 空白 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/legal/privacy` 法务页 | 页面可见性 | 无 | 打开页面 | 隐私政策可阅读，可返回 | 404 / 空白 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/404` 状态页 | 页面可见性与返回主路径 | 无 | 打开页面 | 可见错误说明与返回首页 | 无法返回 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| `/500` 状态页 | 页面可见性与返回主路径 | 无 | 打开页面 | 可见错误说明与返回首页 / 支持 | 无法返回 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| 首页登录拦截弹层 | 关键动作登录拦截 | 未登录 | 点击首页实时助手 / 模拟面试 | 弹层出现，带 returnTo | 直接跳空白登录页 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| 岗位删除确认 | 删除级联文案 | 岗位详情页 | 点击删除 | 同时提示资料与练习记录会删除 | 只提示部分后果 | 人工浏览器 + 代码审查 | `src/App.tsx` | Pass | `src/App.tsx` |
| 实时助手结束确认 | 结束确认文案 | `/live` 页面已有内容 | 点击结束 | 明确说明 transcript 与提词卡会保存 | 无明确后果文案 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| 模拟面试结束确认 | 结束确认文案 | `/mock/room/:id` 已有内容 | 点击结束 | 明确说明 transcript、提词卡、评分与追问结果会保存 | 无明确后果文案 | 自动化 + 人工浏览器 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| 账户与导入导出弹层 | 打开与导入失败提示 | 任意业务页 | 打开弹层并导入异常备份 | 显示失败提示，不覆盖本地状态 | 失败仍覆盖数据 | 自动化 | `src/App.test.tsx` | Pass | `src/App.test.tsx` |
| 反馈弹层 | 打开与提交 | 任意业务页 | 打开反馈弹层并提交 | 提交成功或失败有明确信息 | 静默失败 | 自动化 + 人工浏览器 | `src/App.tsx`, `server/index.ts` | N/A | 待补更细粒度测试 |
| 全局发布门禁 | 聚合命令 | 本地环境满足依赖 | 执行 `npm run verify:acceptance` | 通过后才可宣称“自动化验收通过” | 任一命令失败即阻断 | 自动化 | `package.json` | Pass / Blocked | `package.json`, `docs/acceptance/acceptance-run-report.md` |

## 人工浏览器强制补充项

以下项即使自动化通过，仍必须在 Cursor 或人工浏览器中验收，并将证据回填到上表：

| 页面 | 功能点 | 验收方式 | 结果 | 证据链接 |
| --- | --- | --- | --- | --- |
| 首页 `/` | `1280x720` 首屏仅保留主标题、主输入、岗位卡、主要 CTA、最小右侧上下文 | 人工浏览器 | N/A | 待执行 |
| 模拟房间 `/mock/room/:id` | `1280x720` 顶部状态栏、对话、底部语音控制、题词卡可见 | 人工浏览器 | N/A | 待执行 |
| 面试记录 `/records` | `1280x720` 报告区、时间轴、Transcript 折叠不拥挤 | 人工浏览器 | N/A | 待执行 |
| 移动端全局 | `390px` 导航、按钮、输入框、题词卡、列表不重叠不横向溢出 | 人工浏览器 | N/A | 待执行 |
| 全局控制台 | 无 error | 人工浏览器 | N/A | 待执行 |
