/**
 * LRU 内存缓存：按标准化问题文本缓存最近生成的提词卡。
 * 避免高频问题（如 "自我介绍"）重复请求后端模型。
 */

import { normalizeText } from "./text";
import type { AnswerCueCard } from "../types";

interface CacheEntry {
  card: AnswerCueCard;
  key: string;
}

const MAX_SIZE = 20;
const cache = new Map<string, CacheEntry>();

/** 生成缓存键：标准化问题文本 + 岗位 ID（避免跨岗位混淆） */
export function cacheKey(questionText: string, positionId?: string): string {
  return `${positionId ?? "global"}::${normalizeText(questionText).toLowerCase().slice(0, 120)}`;
}

/** 获取缓存命中 */
export function getCachedCueCard(key: string): AnswerCueCard | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  // LRU：删除再设，使该条目变为最新
  cache.delete(key);
  cache.set(key, entry);
  return entry.card;
}

/** 存入缓存（达到上限时淘汰最久未用） */
export function setCachedCueCard(key: string, card: AnswerCueCard): void {
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= MAX_SIZE) {
    // 淘汰最早的一条（Map 迭代顺序 = 插入顺序）
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { card, key });
}

/** 岗位数据变更时清除相关缓存 */
export function invalidatePosition(positionId: string): void {
  const prefix = `${positionId}::`;
  for (const [key] of cache) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

/** 完全清空 */
export function clearCache(): void {
  cache.clear();
}

/** 当前缓存大小 */
export function cacheSize(): number {
  return cache.size;
}
