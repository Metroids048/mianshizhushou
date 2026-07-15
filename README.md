# yinpinjianting

AI 面试监听提词工具。这个目录从原 AI 求职台复制拆出，聚焦两件事：

- 资料库接地：简历、项目资料、目标 JD。
- 面试提词：手动问题、麦克风、浏览器音频、Windows 系统音频桥转写后生成证据化提词卡。

## 本地启动

```bash
npm install
npm run start
```

默认地址：

- 前端：`http://127.0.0.1:5273/`
- 后端：`http://127.0.0.1:8897/`

Vite 会把 `/api/*` 代理到 `http://127.0.0.1:8897`。如需改端口：

```bash
SERVER_PORT=8897
APP_BASE_URL=http://127.0.0.1:5273
APP_CORS_ORIGIN=http://127.0.0.1:5273
```

## 核心页面

- `/`：监听提词台。
- `/library`：资料库与简历优化。

旧大平台页面在代码中保留为迁移备份，但不再作为新工具入口暴露。

## 音频能力边界

- 麦克风：浏览器授权后采集，优先走服务端 ASR，失败时回退 Web Speech 或文字输入。
- 浏览器音频：实验能力，仅适合浏览器标签页/共享窗口音频。
- 系统音频桥：腾讯会议、飞书等桌面会议客户端应使用 Windows 音频桥。

系统音频桥只转发实时 PCM 分片给服务端 ASR，不落盘保存原始音频。ASR 未配置时必须显示 `ASR_NOT_CONFIGURED`，不能伪装成转写成功。

### 无讯飞时使用本地 Whisper

本地 Whisper 不消耗讯飞额度，模型权重会下载到 `.data/whisper-models`，不会提交到 Git。首次安装需要联网，之后可离线使用：

```powershell
npm run setup:local-whisper
$env:ASR_PROVIDER = "local-whisper"
npm run start
```

默认使用 CPU `base` 模型；可下载更轻的 `tiny` 模型做低配置验证，或使用 `small` 换取识别质量。实际实时性取决于当前 CPU，需要在目标机器上运行音频桥性能验收后再决定默认模型。若全局 Python 路径不同，可设置 `LOCAL_WHISPER_PYTHON`；脚本默认使用 `agent-python`。

### 在线模型降级

实时提词按 `OpenRouter -> GitHub Models -> DeepSeek -> 本地练习` 尝试。令牌只通过系统环境变量配置，不能写入 `.env`、源码或 Git：

```powershell
[Environment]::SetEnvironmentVariable("OPENROUTER_API_KEY", "你的新令牌", "User")
[Environment]::SetEnvironmentVariable("GITHUB_MODELS_TOKEN", "你的新令牌", "User")
```

重新打开终端后启动服务。实时提词在八秒预算内不会对同一 provider 重试或发起 JSON 修复请求，会尽快切换到下一个 provider；本地练习结果始终明确标记。

## 验证

```bash
npm run verify
npm run test:browser-flow
npm run test:perf
```

真实系统音频桥验收需要在 Windows 上启动：

```bash
dotnet run --project audio-bridge/AudioBridge.csproj -- --server http://127.0.0.1:8897
```

如果之前配对过旧后端端口，可以先清除本机桥凭证后重新配对：

```bash
dotnet run --project audio-bridge/AudioBridge.csproj -- --reset --server http://127.0.0.1:8897
```

本地没有讯飞 RTASR 配置时，可以用诊断模式验证“网页配对 → 桥连接 → 系统音频事件 → 页面收到 final 文本”：

```bash
ASR_PROVIDER=debug npm run start
```

诊断模式只证明桥链路可达，不代表真实腾讯会议/飞书转写质量。真实会议转写仍需配置 `XFYUN_RTASR_APP_ID` 与 `XFYUN_RTASR_API_KEY`，并在会议中让对方声音通过当前 Windows 默认播放设备输出。
