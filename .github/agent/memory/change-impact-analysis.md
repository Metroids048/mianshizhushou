# 变更影响分析模板（Change Impact Analysis）

> **目的**：在修改任何文件前，系统性地评估变更的波及范围。预防"改了 A 文件，B/C/D 功能坏掉"的连锁反应。
> **使用时机**：任何跨文件修改、组件替换、类型变更、API 签名修改前。
> **强制要求**：涉及 A 级或 B 级受保护功能时，必须填写此模板并附在任务卡中。

---

## 一、文件依赖拓扑图

### 核心依赖链

```
types.ts ←── 所有 .tsx/.ts（全局类型定义）
    │
router.ts ←── App.tsx（路由解析 + 导航）
    │
auth.ts ←── App.tsx + auth/组件
    │
store.ts ←── App.tsx + jobs.tsx + resume.tsx + conversation.tsx
    │
apiClient.ts ←── App.tsx + live.tsx + resume.tsx + records.tsx
    │
interviewEngine.ts ←── App.tsx + live.tsx + records.tsx
    │
shared.tsx ←── 几乎所有组件（makeId, nowIso, DEFAULT_CONFIG等）
    │
appShell.tsx ←── App.tsx（唯一消费者，但影响所有页面的导航壳）
    │
coach.ts ←── resume.tsx + live.tsx（本地降级逻辑）
    │
resumeImport.ts ←── resume.tsx + questions.tsx

组件依赖：
App.tsx
├── appShell.tsx
├── jobs.tsx（/jobs, /jobs/:id）
├── conversation.tsx（/conversations/:id）
├── resume.tsx（简历Tab，/jobs/:id 内嵌）
├── questions.tsx（资料Tab，/jobs/:id 内嵌）
├── live.tsx（LiveAssistantDashboard + InterviewRoomView）
├── mock-setup.tsx（/mock/setup/:id）
├── records.tsx（/records, /records/:id）
├── auth/AuthPage.tsx
├── auth/RecoveryPages.tsx
├── auth/AuthGate.tsx
├── onboarding/OnboardingPage.tsx
├── account/AccountPage.tsx
├── legal/LegalPage.tsx
└── system/StatusPages.tsx + Seo.tsx
```

### 关键导出依赖

| 源文件 | 被依赖的导出 | 消费者 |
|-------|------------|-------|
| `types.ts` | AppState, Position, InterviewRecord, 全部类型 | 所有组件 + lib |
| `router.ts` | AppRoute, parseRoute, navigateTo | App.tsx |
| `auth.ts` | useAuth | App.tsx, 需要登录状态的组件 |
| `apiClient.ts` | fetchStateSnapshot, updateProfileOnServer, saveRecordOnServer 等 | App.tsx, live.tsx, resume.tsx |
| `interviewEngine.ts` | createInitialAppState, toWorkspace, buildInterviewReport, saveQuestionFromCueCard, normalizePosition | App.tsx, live.tsx |
| `store.ts` | loadServerSnapshotCache, saveServerSnapshotCache, loadDraftState, saveDraftState, loadUiPrefs, saveUiPrefs | App.tsx, jobs.tsx, resume.tsx, appShell.tsx |
| `shared.tsx` | makeId, nowIso, DEFAULT_CONFIG, repairText（通过copy.ts）, 全部共享组件 | 几乎所有组件 |
| `coach.ts` | generateHighlightsLocal | resume.tsx |
| `resumeImport.ts` | importResumeFile | resume.tsx, questions.tsx |
| `copy.ts` | repairAppState, repairText | App.tsx, 所有显示文本的组件 |
| `authClient.ts` | apiFetch | App.tsx（GlobalFeedbackForm） |

---

## 二、变更影响评估矩阵

### 变更类型 → 必检项目

| 变更类型 | 必检项目（除对应功能外） |
|---------|---------------------|
| 修改 `types.ts` 中的类型定义 | 全局搜索该类型的所有引用，逐一检查兼容性 |
| 修改路由（`router.ts`） | `App.tsx` 中的 route.name 匹配（21 条）、导航高亮映射（activeNav）、公开路由集合 |
| 修改 API 函数签名（`apiClient.ts`） | 所有调用点（App.tsx + 各组件）、后端路由匹配 |
| 修改共享工具函数（`shared.tsx`, `copy.ts`） | 全局搜索所有调用点 |
| 修改认证逻辑（`auth.ts`） | AuthGate 弹窗、所有受保护页面的登录检查 |
| 修改状态管理（`store.ts`） | localStorage key 兼容性、缓存结构 |
| 修改 App 壳（`appShell.tsx`） | 所有页面的导航可用性、移动端适配 |
| 删除任何导出 | 全局搜索该导出名的 import 引用 |
| 替换组件实现（stub↔full） | 对照功能清单确认替换方向正确 |

### 风险等级表

| 变更范围 | 风险等级 | 要求 |
|---------|---------|------|
| 单文件、单函数内部修改（不改签名） | 🟢 低 | 本地验证即可 |
| 单文件、修改导出签名 | 🟡 中 | 全局搜索引用 + 更新所有消费者 |
| 跨 2-3 文件修改 | 🟠 高 | 填写影响分析 + 手动走查受影响功能 |
| 跨 4+ 文件或修改 types.ts | 🔴 极高 | 完整影响分析 + verify + 全部 A/B 级功能手动回归 |

---

## 三、变更影响分析模板

```markdown
# 变更影响分析

## 变更概述
- **任务名称**：___
- **变更类型**：新增 / 修改 / 删除 / 重构
- **风险等级**：🟢低 / 🟡中 / 🟠高 / 🔴极高

## 变更文件清单
| 文件 | 操作 | 变更内容 |
|------|------|---------|
| `X.tsx` | 修改 | 改变了 Y 函数的参数签名 |
| `Z.ts` | 新增 | 新增工具函数 |

## 依赖分析
| 被修改的导出 | 消费者文件 | 是否兼容 | 需要的适配 |
|------------|-----------|---------|-----------|
| `parseRoute` 签名变更 | `App.tsx` L180 | ❌ 不兼容 | 需要更新 route.name 匹配逻辑 |

## 受保护功能影响评估（对照 feature-regression-guard.md）
| 功能编号 | 功能名 | 受影响？ | 说明 |
|---------|-------|---------|------|
| A1 | 岗位输入与保存 | 否 | — |
| A2 | 路由解析与导航 | 是 | parseRoute 签名变更影响所有路由解析 |
| ... | ... | ... | ... |

## 验证计划
- [ ] `npm run verify` 通过
- [ ] 手动走查受影响的关键路径
- [ ] 检查受影响功能的边界情况
```

---

## 四、实际操作建议

1. **改前搜索**：修改任何导出前，先 `grep` 该导出名确认所有引用位置
2. **最小 diff**：优先选择不影响签名的修改方式，如确实需要改签名，先更新所有消费者再改定义
3. **增量提交**：不要在一个 PR 中混合类型变更 + 功能变更
4. **回退方案**：每次变更前想好如何回退（git revert 是最低要求）
