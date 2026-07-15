import { createHash, createHmac } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";

export type AsrEvent =
  | { type: "ready"; provider: "xfyun" | "debug" | "local-whisper" }
  | { type: "interim"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; code: "ASR_NOT_CONFIGURED" | "ASR_CONNECT_FAILED" | "ASR_UPSTREAM_ERROR"; message: string }
  | { type: "done" };

export interface XfyunRelay {
  feedAudio(chunk: Buffer): void;
  feedEnd(): void;
  close(): void;
}

interface XfyunPayload {
  action?: "started" | "result" | "error";
  code?: string;
  data?: string;
  desc?: string;
}

export function createAsrRelay(onEvent: (event: AsrEvent) => void): XfyunRelay | null {
  const provider = (process.env.ASR_PROVIDER ?? "xfyun").trim().toLowerCase();
  if (provider === "debug") {
    return createDebugRelay(onEvent);
  }
  if (provider === "local-whisper") return createLocalWhisperRelay(onEvent);
  return createXfyunRelay(onEvent);
}

function createLocalWhisperRelay(onEvent: (event: AsrEvent) => void): XfyunRelay | null {
  const python = process.env.LOCAL_WHISPER_PYTHON?.trim() || process.env.AGENT_PYTHON?.trim() || "agent-python";
  const worker = process.env.LOCAL_WHISPER_WORKER?.trim()
    || resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "local_whisper_worker.py");
  const model = process.env.LOCAL_WHISPER_MODEL?.trim() || "base";
  const downloadRoot = process.env.LOCAL_WHISPER_DOWNLOAD_ROOT?.trim()
    || resolve(dirname(fileURLToPath(import.meta.url)), "..", ".data", "whisper-models");
  const chunkBytes = Math.max(32_000, Number(process.env.LOCAL_WHISPER_CHUNK_BYTES) || 96_000);
  if (!/^[a-z0-9._-]+$/i.test(model)) {
    onEvent({ type: "error", code: "ASR_NOT_CONFIGURED", message: "LOCAL_WHISPER_MODEL 只能包含字母、数字、点、下划线或连字符。" });
    return null;
  }
  let workerProcess: ChildProcessWithoutNullStreams;
  try {
    const args = [worker, "--model", model, "--download-root", downloadRoot];
    const useWindowsCommandShell = process.platform === "win32" && !/\.exe$/i.test(python);
    const command = useWindowsCommandShell ? process.env.ComSpec ?? "cmd.exe" : python;
    const commandArgs = useWindowsCommandShell
      ? ["/d", "/s", "/c", `"${python}" "${worker}" --model "${model}" --download-root "${downloadRoot}"`]
      : args;
    workerProcess = spawn(command, commandArgs, {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
  } catch {
    onEvent({ type: "error", code: "ASR_NOT_CONFIGURED", message: "本地 Whisper 未安装。请先运行 scripts/setup-local-whisper.ps1。" });
    return null;
  }

  let closed = false;
  let pending = false;
  let ending = false;
  let reportedError = false;
  let buffered = Buffer.alloc(0);
  let requestId = 0;
  const stderr: string[] = [];
  const sendChunk = () => {
    if (closed || pending || buffered.length === 0) return;
    const pcm = buffered;
    buffered = Buffer.alloc(0);
    pending = true;
    requestId += 1;
    workerProcess.stdin.write(`${JSON.stringify({ id: requestId, pcm16Base64: pcm.toString("base64") })}\n`);
  };
  const finishIfReady = () => {
    if (!ending || pending || buffered.length > 0 || closed) return;
    closed = true;
    onEvent({ type: "done" });
    workerProcess.kill();
  };

  createInterface({ input: workerProcess.stdout }).on("line", (line) => {
    const event = safeJsonParse<{ type?: string; text?: string; message?: string }>(line);
    if (!event) return;
    if (event.type === "ready") onEvent({ type: "ready", provider: "local-whisper" });
    if (event.type === "result") {
      pending = false;
      if (event.text?.trim()) onEvent({ type: "final", text: event.text.trim() });
      sendChunk();
      finishIfReady();
    }
    if (event.type === "error") {
      pending = false;
      reportedError = true;
      const message = event.message || "本地 Whisper 转写失败。";
      onEvent({ type: "error", code: message.includes("缺少本地 Whisper 依赖") ? "ASR_NOT_CONFIGURED" : "ASR_UPSTREAM_ERROR", message });
      finishIfReady();
    }
  });
  createInterface({ input: workerProcess.stderr }).on("line", (line) => stderr.push(line));
  workerProcess.on("error", () => {
    if (!closed && !reportedError) onEvent({ type: "error", code: "ASR_CONNECT_FAILED", message: "本地 Whisper worker 无法启动。请运行 scripts/setup-local-whisper.ps1。" });
  });
  workerProcess.on("exit", (code) => {
    if (!closed && !reportedError && code !== 0) onEvent({ type: "error", code: "ASR_UPSTREAM_ERROR", message: stderr.join(" ").slice(-300) || "本地 Whisper worker 已退出。" });
  });

  return {
    feedAudio(chunk: Buffer) {
      if (closed) return;
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length >= chunkBytes) sendChunk();
    },
    feedEnd() {
      if (closed) return;
      ending = true;
      sendChunk();
      finishIfReady();
    },
    close() {
      closed = true;
      workerProcess.kill();
    },
  };
}

// 讯飞上游连接与协议解析：供浏览器麦克风路由和音频桥路由共用，避免重复实现同一份中转逻辑。
export function createXfyunRelay(onEvent: (event: AsrEvent) => void): XfyunRelay | null {
  const config = getXfyunConfig();
  if (!config) {
    onEvent({ type: "error", code: "ASR_NOT_CONFIGURED", message: "讯飞实时语音转写未配置，已回退到浏览器语音或文字输入。" });
    return null;
  }

  const upstream = new WebSocket(buildXfyunUrl(config));
  let upstreamReady = false;

  upstream.on("open", () => {
    upstreamReady = true;
  });

  upstream.on("message", (raw) => {
    const parsed = safeJsonParse<XfyunPayload>(raw.toString());
    if (!parsed) return;
    if (parsed.action === "started") {
      onEvent({ type: "ready", provider: "xfyun" });
      return;
    }
    if (parsed.action === "error" || (parsed.code && parsed.code !== "0")) {
      onEvent({ type: "error", code: "ASR_UPSTREAM_ERROR", message: parsed.desc || `讯飞转写失败：${parsed.code ?? "UNKNOWN"}` });
      return;
    }
    if (parsed.action === "result" && parsed.data) {
      const result = parseXfyunResult(parsed.data);
      if (!result.text) return;
      onEvent({ type: result.final ? "final" : "interim", text: result.text });
    }
  });

  upstream.on("error", () => {
    onEvent({ type: "error", code: "ASR_CONNECT_FAILED", message: "讯飞实时语音转写连接失败，已回退到浏览器语音或文字输入。" });
  });

  upstream.on("close", () => {
    onEvent({ type: "done" });
  });

  return {
    feedAudio(chunk: Buffer) {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(chunk);
    },
    feedEnd() {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ end: true }));
    },
    close() {
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ end: true }));
      upstream.close();
    },
  };
}

export function registerXfyunAsrRoute(app: FastifyInstance): void {
  app.get("/api/asr/xfyun/stream", { websocket: true }, (socket) => {
    const send = (event: AsrEvent) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
      if (event.type === "done") socket.close();
    };

    const relay = createAsrRelay(send);
    if (!relay) {
      socket.close();
      return;
    }

    socket.on("message", (message, isBinary) => {
      if (!isBinary) {
        const text = message.toString();
        const control = safeJsonParse<{ end?: boolean }>(text);
        if (control?.end) relay.feedEnd();
        return;
      }
      relay.feedAudio(message as Buffer);
    });

    socket.on("close", () => {
      relay.close();
    });
  });
}

function createDebugRelay(onEvent: (event: AsrEvent) => void): XfyunRelay {
  const texts = (process.env.ASR_DEBUG_TEXT?.trim() || "请介绍一个你做过的 AI 产品项目，以及你具体负责什么？")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
  const threshold = Number(process.env.ASR_DEBUG_FINAL_AFTER_BYTES) > 0 ? Number(process.env.ASR_DEBUG_FINAL_AFTER_BYTES) : 32_000;
  let bufferedBytes = 0;
  let emitted = 0;
  let closed = false;

  queueMicrotask(() => {
    if (!closed) onEvent({ type: "ready", provider: "debug" });
  });

  const emitFinal = () => {
    const text = texts[emitted % texts.length] ?? texts[0];
    emitted += 1;
    bufferedBytes = 0;
    onEvent({ type: "final", text });
  };

  return {
    feedAudio(chunk: Buffer) {
      if (closed) return;
      bufferedBytes += chunk.length;
      if (bufferedBytes >= Math.max(1, Math.floor(threshold / 2)) && emitted === 0) {
        onEvent({ type: "interim", text: texts[0] ?? "正在接收系统音频..." });
      }
      if (bufferedBytes >= threshold) emitFinal();
    },
    feedEnd() {
      if (closed) return;
      if (bufferedBytes > 0 || emitted === 0) emitFinal();
      onEvent({ type: "done" });
    },
    close() {
      closed = true;
    },
  };
}

function getXfyunConfig():
  | { appId: string; apiKey: string; endpoint: string; language?: string }
  | null {
  if ((process.env.ASR_PROVIDER ?? "xfyun").trim().toLowerCase() !== "xfyun") return null;
  const appId = process.env.XFYUN_RTASR_APP_ID?.trim();
  const apiKey = process.env.XFYUN_RTASR_API_KEY?.trim();
  if (!appId || !apiKey) return null;
  return {
    appId,
    apiKey,
    endpoint: process.env.XFYUN_RTASR_ENDPOINT?.trim() || "wss://rtasr.xfyun.cn/v1/ws",
    language: process.env.XFYUN_RTASR_LANG?.trim() || "cn",
  };
}

function buildXfyunUrl(config: { appId: string; apiKey: string; endpoint: string; language?: string }): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const md5 = createHash("md5").update(`${config.appId}${ts}`).digest("hex");
  const signa = createHmac("sha1", config.apiKey).update(md5).digest("base64");
  const url = new URL(config.endpoint);
  url.searchParams.set("appid", config.appId);
  url.searchParams.set("ts", ts);
  url.searchParams.set("signa", signa);
  if (config.language) url.searchParams.set("lang", config.language);
  return url.toString();
}

function parseXfyunResult(data: string): { text: string; final: boolean } {
  const parsed = safeJsonParse<{
    cn?: { st?: { type?: string; rt?: Array<{ ws?: Array<{ cw?: Array<{ w?: string }> }> }> } };
  }>(data);
  const st = parsed?.cn?.st;
  const text =
    st?.rt
      ?.flatMap((item) => item.ws ?? [])
      .flatMap((item) => item.cw ?? [])
      .map((item) => item.w ?? "")
      .join("")
      .trim() ?? "";
  return { text, final: st?.type === "0" };
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
