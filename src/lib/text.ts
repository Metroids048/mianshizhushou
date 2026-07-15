const STOP_WORDS = new Set([
  "负责",
  "协助",
  "提升",
  "进行",
  "相关",
  "以及",
  "通过",
  "能力",
  "岗位",
  "用户",
  "产品",
  "工作",
  "项目",
  "工具",
  "完成",
  "输出",
  "使用",
  "基础",
  "以上",
]);

export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

export function splitLines(text: string): string[] {
  return normalizeText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function extractKeywords(text: string, limit = 28): string[] {
  const normalized = normalizeText(text);
  const tokens = normalized.match(/[A-Za-z][A-Za-z+#.]{1,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  const counts = new Map<string, number>();

  tokens.forEach((raw) => {
    const token = raw.toLowerCase();
    if (STOP_WORDS.has(token) || token.length < 2) return;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([token]) => token);
}

export function findMetrics(text: string): string[] {
  const matches =
    text.match(/(?:\d+(?:\.\d+)?%|\d+(?:,\d{3})+|\d+\s*(?:人|名|个|次|周|月|天|场|小时|百分点|秒))/g) ?? [];
  return unique(matches).slice(0, 12);
}

export function scoreOverlap(source: string[], target: string[]): number {
  if (target.length === 0) return 0;
  const sourceSet = new Set(source.map((item) => item.toLowerCase()));
  const hits = target.filter((item) => sourceSet.has(item.toLowerCase()));
  return Math.round((hits.length / target.length) * 100);
}

export function sentenceIncludesAny(sentence: string, keywords: string[]): boolean {
  return keywords.some((keyword) => sentence.toLowerCase().includes(keyword.toLowerCase()));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
