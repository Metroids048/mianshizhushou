# 公开 MVP 接口与数据契约

更新时间：2026-06-19

## 1. 文档目的

本文件定义公开 MVP 阶段的接口、类型扩展和存储契约。目标是让后续开发直接对齐现有仓库，而不是边写边猜。

## 2. 现有兼容原则

- 保留当前页面路由
- 保留当前主要 API 名称
- 允许后端内部重构实现
- 前端不再引入新的业务真源

## 3. 前端本地状态契约

前端仅允许保留三类本地对象：

- `serverSnapshotCache`
  - 最后一次成功拉取的服务端快照
- `uiPrefs`
  - 例如桌面侧栏展开状态、自动生成开关
- `drafts`
  - 首页输入、简历对话输入、未提交文本草稿

禁止：

- 在本地保存完整可编辑业务主状态作为真源
- 双向抢写岗位、资料、问题、记录

## 4. 后端业务真源

服务端持久化真源固定包括：

- `profile`
- `positions`
- `records`
- `documents`
- `document_chunks`
- `retrieval_runs`
- `prompt_runs`

## 5. RAG 数据结构

### 5.1 RagDocument

```ts
interface RagDocument {
  id: string;
  positionId?: string;
  sourceType: "resume" | "jd" | "material" | "question" | "record";
  sourceId: string;
  title: string;
  rawText: string;
  priority: number;
  updatedAt: string;
}
```

说明：

- `positionId` 为空时表示全局资料，例如简历
- `priority` 用于后续召回重排

### 5.2 RagChunk

```ts
interface RagChunk {
  id: string;
  documentId: string;
  positionId?: string;
  sourceType: RagDocument["sourceType"];
  sourceId: string;
  chunkIndex: number;
  text: string;
  priority: number;
  updatedAt: string;
}
```

说明：

- 切块目标为 300–500 字
- 同一文档允许少量 overlap

### 5.3 RetrievalRun

```ts
interface RetrievalRun {
  id: string;
  promptRunId?: string;
  query: string;
  positionId?: string;
  topK: number;
  hits: Array<{
    chunkId: string;
    sourceType: RagChunk["sourceType"];
    sourceId: string;
    score: number;
    rank: number;
  }>;
  latencyMs: number;
  createdAt: string;
}
```

## 6. AI 运行元数据契约

### 6.1 AiRunMeta 扩展

现有 `AiRunMeta` 增补以下字段：

```ts
interface AiRunMeta {
  backendStatus: "success" | "fallback" | "error" | "cache";
  fallbackReason: string;
  evidenceTrace: Array<{ id: string; title: string; reason: string }>;
  latencyMs: number;
  promptId?: string;
  provider?: string;
  retrievalCount?: number;
  searchUsed?: boolean;
}
```

约束：

- 所有模型结果都必须返回 `backendStatus`
- 只要使用了 RAG，就必须返回 `retrievalCount`
- 只要触发了搜索，就必须标记 `searchUsed`

### 6.2 prompt_runs 扩展

`prompt_runs` 继续保留，并扩充以下记录含义：

- `promptId`
- `provider`
- `status`
- `latencyMs`
- `retrievalCount`
- `searchUsed`
- `fallbackReason`

## 7. SSE 契约

### 7.1 CueCardStreamEvent

提词卡流式接口统一输出以下事件：

```ts
type CueCardStreamEvent =
  | { event: "stage"; data: { label: string; status: "running" | "done" | "fallback" } }
  | { event: "delta"; data: { text: string } }
  | { event: "card"; data: { card: AnswerCueCard; meta: AiRunMeta } }
  | { event: "done"; data: { ok: true } }
  | { event: "error"; data: { message: string; fallback: boolean } };
```

约束：

- `stage` 用于显示进度，不代表模型一定成功
- `card` 才是最终结构化结果
- `error` 不应让前端误判为完全不可用；若已存在本地 fallback，则前端停留在本地卡

## 8. 简历 AI 对话契约

### 8.1 ResumeAiRequest

```ts
interface ResumeAiRequest {
  action: "section" | "full" | "match";
  sectionId?: string;
  userMessage?: string;
  positionId?: string;
  resumeText: string;
}
```

### 8.2 ResumeAiResponse

```ts
interface ResumeAiResponse {
  reply: string;
  suggestion: string;
  evidenceTrace: Array<{ id: string; title: string; reason: string }>;
  applyTarget: "section" | "full";
  meta: AiRunMeta;
}
```

约束：

- `action=section` 时必须能回填到当前区块
- `action=full` 时输出整份统一改写建议
- `action=match` 时必须显式结合当前岗位

## 9. 现有 API 保留与增强

### 保留现有路径

- `GET /api/state`
- `POST /api/positions/intake`
- `POST /api/profile`
- `POST /api/positions/:id/materials`
- `POST /api/positions/:id/questions`
- `POST /api/copilot/cue-card/stream`
- `POST /api/copilot/cue-card/reconstruct`
- `POST /api/copilot/follow-up`
- `POST /api/mock/session`
- `POST /api/mock/session/:id/answer`
- `POST /api/records`

### 新增建议路径

- `POST /api/resume/ai`
  - 简历右侧 AI 对话统一入口
- `POST /api/rag/reindex`
  - 仅供内部调试或恢复索引使用，不暴露到常规用户流程

## 10. 写入触发契约

以下写操作必须触发对应资料增量刷新：

- 岗位 intake 更新
  - 更新 `jd` 文档和切块
- 简历与证据更新
  - 更新 `resume` 文档和切块
- 项目资料更新
  - 更新 `material` 文档和切块
- 问题更新
  - 更新 `question` 文档和切块
- 记录保存
  - 更新 `record` 摘要文档和切块

禁止靠人工手动补索引维持一致性。

## 11. 音频与记录契约

`InterviewRecord` 本轮继续不保存原始音频，仅保存：

- `transcript`
- `cueCards`
- `speechMetrics`
- `report`
- `conversationHistory`
- `aiMeta`

这也是后续合规和本地存储控制的默认边界。

## 12. 数据库表建议

在现有 SQLite 基础上新增：

- `documents`
- `document_chunks`
- `retrieval_runs`

现有表继续保留：

- `app_state`
- `cue_cards`
- `interview_records`
- `search_results`
- `prompt_runs`
- `mock_sessions`
- `cue_card_cache`

## 13. 实现约束

- 所有新接口都必须有 Zod schema
- 所有 Prompt 只允许定义在统一 registry 中
- 所有模型调用必须只经过一个统一 AI client 入口，入口内部允许按 OpenRouter、GitHub Models、DeepSeek、本地 fallback 的顺序降级
- 所有 AI 响应必须能说明成功、fallback 或失败

## 14. 语音 ASR WebSocket

### `GET /api/asr/xfyun/stream`

用途：浏览器麦克风音频分片转写。服务端只转发音频到讯飞 RTASR，不落盘保存原始音频。

客户端输入：

- 二进制：16kHz、16-bit、mono PCM 分片
- 文本控制：`{"end":true}`

服务端输出事件：

- `{"type":"ready","provider":"xfyun"}`
- `{"type":"interim","text":"..."}`
- `{"type":"final","text":"..."}`
- `{"type":"error","code":"ASR_NOT_CONFIGURED"|"ASR_CONNECT_FAILED"|"ASR_UPSTREAM_ERROR","message":"..."}`
- `{"type":"done"}`

失败语义：

- `ASR_NOT_CONFIGURED`：未配置讯飞实时语音转写密钥，前端回退 Web Speech 或文字输入
- `ASR_CONNECT_FAILED`：讯飞连接失败，前端回退 Web Speech 或文字输入
- `ASR_UPSTREAM_ERROR`：讯飞返回错误，前端保留已识别文本并提示降级

## 15. Windows 音频桥接口

音频桥用于用户主动授权后的 Windows 系统音频监听。配对、设备管理和事件订阅全部按当前登录账号隔离；桌面桥程序用设备令牌连接 WebSocket 摄取端。

### `POST /api/audio-bridge/pair`

用途：登录用户生成 6 位一次性配对码。

响应：

- `pairingCode: string`
- `expiresAt: string`

### `POST /api/audio-bridge/claim`

用途：Windows 音频桥程序提交配对码并领取长期设备令牌。

请求：

- `pairingCode: string`
- `deviceName?: string`

响应：

- `deviceToken: string`

### `GET /api/audio-bridge/devices`

用途：列出当前账号已配对且未撤销的音频桥设备。

响应：

- `devices: Array<{ id: string; deviceName: string; createdAt: string; lastSeenAt: string }>`

### `DELETE /api/audio-bridge/devices/:id`

用途：撤销当前账号名下的音频桥设备。

响应：

- `ok: true`

### `GET /api/audio-bridge/events`

用途：浏览器订阅当前账号的音频桥连接、ASR 和诊断事件。

输出事件：

- `{"type":"bridge_status","connected":true,"deviceName":"..."}`
- `{"type":"bridge_status","connected":false}`
- `{"type":"ready","provider":"xfyun"}`
- `{"type":"interim","text":"..."}`
- `{"type":"final","text":"..."}`
- `{"type":"error","code":"ASR_NOT_CONFIGURED"|"ASR_CONNECT_FAILED"|"ASR_UPSTREAM_ERROR","message":"..."}`
- `{"type":"done"}`

### `WS /api/audio-bridge/stream`

用途：Windows 音频桥程序用 `deviceToken` 推送系统音频 PCM 分片。服务端只转发给 ASR，不落盘保存原始音频。

失败语义：

- 缺少或无效设备令牌：关闭音频桥 WebSocket
- `ASR_NOT_CONFIGURED`：向浏览器事件流发送错误，并关闭音频桥 WebSocket
- 设备被撤销：后续连接不再被接受
