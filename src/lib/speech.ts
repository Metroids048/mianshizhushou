// Thin wrappers over the browser-native Web Speech API (SpeechRecognition +
// speechSynthesis). Everything here is client-side and runs only after an
// explicit user click — used for interview *preparation* practice, never for
// covert assistance during a real interview. All APIs are feature-detected so
// unsupported browsers (and jsdom in tests) degrade gracefully.

// SpeechRecognition is not part of lib.dom.d.ts, so declare the minimal shape.
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== undefined || isServerAsrSupported();
}

export function getSpeechRecognitionSupport(): { supported: boolean; fullySupported: boolean } {
  if (typeof window === "undefined") {
    return { supported: false, fullySupported: false };
  }
  const supported = isSpeechRecognitionSupported();
  const ua = window.navigator.userAgent;
  const isChrome = /Chrome/i.test(ua) && !/Edg/i.test(ua);
  const isEdge = /Edg/i.test(ua);
  return {
    supported,
    fullySupported: supported && (isServerAsrSupported() || isChrome || isEdge),
  };
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export interface DictationHandle {
  stop: () => void;
}

interface DictationOptions {
  lang?: string;
  onText: (text: string, isFinal: boolean) => void;
  onError: (message: string) => void;
  onEnd: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许后重试。",
  "service-not-allowed": "麦克风权限被拒绝，请在浏览器设置中允许后重试。",
  "no-speech": "没有检测到语音，请靠近麦克风再试一次。",
  "audio-capture": "未检测到麦克风设备。",
  network: "语音识别服务网络异常，请稍后再试。",
};

export function startDictation(options: DictationOptions): DictationHandle | null {
  if (isServerAsrSupported()) {
    return startServerAsrDictation(options);
  }
  return startWebSpeechDictation(options);
}

export function startBrowserAudioDictation(options: DictationOptions): DictationHandle | null {
  if (typeof window === "undefined") return null;
  if (
    typeof WebSocket === "undefined" ||
    typeof window.navigator.mediaDevices?.getDisplayMedia !== "function" ||
    getAudioContextCtor() === undefined
  ) {
    return null;
  }
  return startDisplayAudioAsrDictation(options);
}

function startWebSpeechDictation(options: DictationOptions): DictationHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = options.lang ?? "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript ?? "";
      options.onText(transcript, result.isFinal);
    }
  };
  recognition.onerror = (event) => {
    options.onError(ERROR_MESSAGES[event.error] ?? "语音识别出错，请改用文字作答。");
  };
  recognition.onend = () => options.onEnd();

  try {
    recognition.start();
  } catch {
    return null;
  }
  return { stop: () => recognition.stop() };
}

function isServerAsrSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof WebSocket !== "undefined" &&
    typeof window.navigator.mediaDevices?.getUserMedia === "function" &&
    getAudioContextCtor() !== undefined
  );
}

function startServerAsrDictation(options: DictationOptions): DictationHandle {
  const fallbackToWebSpeech = () => startWebSpeechDictation(options);
  const socket = new WebSocket(resolveAsrSocketUrl());
  socket.binaryType = "arraybuffer";
  let stopped = false;
  let ended = false;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;
  let activeFallback: DictationHandle | null = null;

  const finish = () => {
    if (ended) return;
    ended = true;
    options.onEnd();
  };

  const cleanupAudio = () => {
    processor?.disconnect();
    source?.disconnect();
    processor = null;
    source = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void audioContext?.close().catch(() => undefined);
    audioContext = null;
  };

  const stopSocket = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ end: true }));
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };

  const startAudio = async () => {
    if (stopped || stream) return;
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    stream = await window.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    audioContext = new AudioContextCtor();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (stopped || socket.readyState !== WebSocket.OPEN || !audioContext) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleTo16kPcm(input, audioContext.sampleRate);
      sendPcmChunks(socket, pcm);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  };

  const fallBackOrError = (message: string) => {
    cleanupAudio();
    const fallback = fallbackToWebSpeech();
    if (fallback) {
      socket.onclose = null;
      socket.onerror = null;
      stopSocket();
      activeFallback = fallback;
      return;
    }
    stopSocket();
    options.onError(message);
    finish();
  };

  socket.onmessage = (event) => {
    const payload = safeJsonParse<{ type?: string; text?: string; code?: string; message?: string }>(String(event.data));
    if (!payload?.type) return;
    if (payload.type === "ready") {
      void startAudio().catch(() => fallBackOrError("麦克风启动失败，请重试或直接输入文字。"));
      return;
    }
    if ((payload.type === "interim" || payload.type === "final") && payload.text) {
      options.onText(payload.text, payload.type === "final");
      return;
    }
    if (payload.type === "error") {
      fallBackOrError(payload.message || "云端语音识别不可用，已切换到浏览器语音或文字输入。");
    }
  };
  socket.onerror = () => fallBackOrError("云端语音识别连接失败，已切换到浏览器语音或文字输入。");
  socket.onclose = () => {
    cleanupAudio();
    if (!activeFallback) finish();
  };

  return {
    stop: () => {
      stopped = true;
      if (activeFallback) {
        activeFallback.stop();
        return;
      }
      cleanupAudio();
      stopSocket();
    },
  };
}

function startDisplayAudioAsrDictation(options: DictationOptions): DictationHandle {
  const socket = new WebSocket(resolveAsrSocketUrl());
  socket.binaryType = "arraybuffer";
  let stopped = false;
  let ended = false;
  let audioContext: AudioContext | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;

  const finish = () => {
    if (ended) return;
    ended = true;
    options.onEnd();
  };

  const cleanupAudio = () => {
    processor?.disconnect();
    source?.disconnect();
    processor = null;
    source = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void audioContext?.close().catch(() => undefined);
    audioContext = null;
  };

  const stopSocket = () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ end: true }));
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
  };

  const startAudio = async () => {
    if (stopped || stream) return;
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) throw new Error("AUDIO_CONTEXT_UNSUPPORTED");
    stream = await window.navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (stream.getAudioTracks().length === 0) {
      throw new Error("DISPLAY_AUDIO_NOT_SELECTED");
    }
    audioContext = new AudioContextCtor();
    source = audioContext.createMediaStreamSource(stream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      if (stopped || socket.readyState !== WebSocket.OPEN || !audioContext) return;
      const input = event.inputBuffer.getChannelData(0);
      const pcm = downsampleTo16kPcm(input, audioContext.sampleRate);
      sendPcmChunks(socket, pcm);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
  };

  const fail = (message: string) => {
    cleanupAudio();
    stopSocket();
    options.onError(message);
    finish();
  };

  socket.onmessage = (event) => {
    const payload = safeJsonParse<{ type?: string; text?: string; message?: string }>(String(event.data));
    if (!payload?.type) return;
    if (payload.type === "ready") {
      void startAudio().catch((error) => {
        fail(
          String(error).includes("DISPLAY_AUDIO_NOT_SELECTED")
            ? "没有选择可共享的浏览器音频，请重新选择带音频的标签页或窗口。"
            : "浏览器音频启动失败，请改用麦克风或系统音频桥。",
        );
      });
      return;
    }
    if ((payload.type === "interim" || payload.type === "final") && payload.text) {
      options.onText(payload.text, payload.type === "final");
      return;
    }
    if (payload.type === "error") {
      fail(payload.message || "云端语音识别不可用，浏览器音频暂时不能转写。");
    }
  };
  socket.onerror = () => fail("云端语音识别连接失败，浏览器音频暂时不能转写。");
  socket.onclose = () => {
    cleanupAudio();
    finish();
  };

  return {
    stop: () => {
      stopped = true;
      cleanupAudio();
      stopSocket();
    },
  };
}

function resolveAsrSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/asr/xfyun/stream`;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const scope = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

function downsampleTo16kPcm(input: Float32Array, inputSampleRate: number): ArrayBuffer {
  const targetSampleRate = 16000;
  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const outputLength = Math.max(1, Math.floor(input.length / sampleRateRatio));
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = Math.floor(i * sampleRateRatio);
    const sample = Math.max(-1, Math.min(1, input[sourceIndex] ?? 0));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function sendPcmChunks(socket: WebSocket, pcm: ArrayBuffer): void {
  const chunkSize = 1280;
  for (let offset = 0; offset < pcm.byteLength; offset += chunkSize) {
    socket.send(pcm.slice(offset, Math.min(offset + chunkSize, pcm.byteLength)));
  }
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function speak(text: string, lang = "zh-CN"): void {
  if (!isSpeechSynthesisSupported() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function cancelSpeak(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}
