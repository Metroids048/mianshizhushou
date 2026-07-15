const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "需要先登录后才能继续。",
  POSITION_NOT_FOUND: "当前岗位不存在或已被删除，请回到首页重新选择。",
  RECORD_NOT_FOUND: "这条记录不存在或已被删除。",
  MOCK_SESSION_NOT_FOUND: "这场模拟面试已失效，请重新开始一轮。",
  INVALID_IMPORT: "导入文件不是有效的备份数据。",
  INTERNAL_ERROR: "服务端处理失败，请稍后重试。",
  QUOTA_EXCEEDED: "今日该功能的免费 AI 额度已用完，明天 0 点重置。",
  DEEPSEEK_TIMEOUT: "模型响应超时",
  SAVE_FAILED: "记录保存失败",
};

type StructuredError = {
  error?: string;
  message?: string;
};

function toRawErrorText(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  if (error && typeof error === "object") {
    const candidate = error as StructuredError;
    if (typeof candidate.message === "string" && candidate.message.trim()) return candidate.message.trim();
    if (typeof candidate.error === "string" && candidate.error.trim()) return candidate.error.trim();
  }
  return "";
}

function parseStructuredError(raw: string): StructuredError | null {
  if (!raw.startsWith("{")) return null;
  try {
    return JSON.parse(raw) as StructuredError;
  } catch {
    return null;
  }
}

export function describeRequestError(error: unknown, fallback = "请求失败，请稍后重试。"): string {
  const raw = toRawErrorText(error);
  if (!raw) return fallback;

  const structured = parseStructuredError(raw);
  const code = structured?.error?.trim();
  const message = structured?.message?.trim();

  if (message) return message;
  if (code && KNOWN_ERROR_MESSAGES[code]) return KNOWN_ERROR_MESSAGES[code];

  if (/failed to fetch|network|offline/i.test(raw)) return "网络连接失败";
  if (/timeout|timed out|超时/i.test(raw)) return "模型响应超时";
  if (raw.startsWith("{")) return fallback;

  return raw.replace(/^Error:\s*/i, "").trim() || fallback;
}

export function describeAiFailure(error: unknown, fallback = "服务端暂时不可用"): string {
  const reason = describeRequestError(error, fallback);
  if (/网络|offline|fetch/i.test(reason)) return "网络连接失败";
  if (/超时|timeout/i.test(reason)) return "模型响应超时";
  return reason;
}
