import { repairText } from "./copy";
import type { ResumeSectionId } from "../components/sharedConfig";

export function normalizeResumeSuggestion(text: string): string {
  return repairText(text).trim();
}

export function isStructuredFullResumeSuggestion(text: string, sections: Array<{ id: ResumeSectionId; title: string }>): boolean {
  const normalized = normalizeResumeSuggestion(text);
  if (!normalized) return false;
  return sections.some((section) => normalized.includes(section.title));
}

export function parseFullResumeSuggestion(text: string, sections: Array<{ id: ResumeSectionId; title: string }>): Partial<Record<ResumeSectionId, string>> {
  const normalized = normalizeResumeSuggestion(text);
  if (!normalized) return {};

  const titles = sections
    .map((section) => ({ id: section.id, title: section.title }))
    .sort((a, b) => b.title.length - a.title.length);

  const markers = titles
    .map((section) => {
      const index = normalized.indexOf(section.title);
      return index >= 0 ? { ...section, index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a!.index - b!.index) as Array<{ id: ResumeSectionId; title: string; index: number }>;

  if (markers.length === 0) return {};

  const next: Partial<Record<ResumeSectionId, string>> = {};
  markers.forEach((marker, index) => {
    const start = marker.index + marker.title.length;
    const end = markers[index + 1]?.index ?? normalized.length;
    const block = normalized
      .slice(start, end)
      .replace(/^[\s:：-]+/, "")
      .trim();
    if (block) next[marker.id] = block;
  });

  return next;
}

export function applyFullResumeSuggestionToDrafts(
  suggestion: string,
  sections: Array<{ id: ResumeSectionId; title: string }>,
  currentDrafts: Record<ResumeSectionId, string>,
): Partial<Record<ResumeSectionId, string>> {
  const parsed = parseFullResumeSuggestion(suggestion, sections);
  if (Object.keys(parsed).length > 0) return parsed;
  if (isStructuredFullResumeSuggestion(suggestion, sections)) return {};
  return {
    ...currentDrafts,
    highlights: normalizeResumeSuggestion(suggestion),
  };
}
