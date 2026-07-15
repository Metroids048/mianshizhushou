import type { CandidateProfile, InterviewQuestion, InterviewRecord, Position, PositionMaterial } from "../src/types";
import type { AppDb } from "./db";
import type { RagChunk, RagDocument, RagSourceType, RetrievalRun } from "./types";
import { makeId, nowIso } from "./utils";

const CHUNK_TARGET = 420;
const CHUNK_OVERLAP = 60;
const MAX_RETRIEVAL = 5;
const SAME_SOURCE_LIMIT = 2;

type RetrievalPriority = Record<string, number>;

export interface RetrievedChunk extends RagChunk {
  score: number;
}

type RankedChunk = RetrievedChunk & { _groupKey: string };

export interface RagRuntime {
  reindexProfile(profile: CandidateProfile): void;
  reindexPosition(position: Position): void;
  reindexQuestions(positionId: string, questions: InterviewQuestion[]): void;
  reindexMaterials(positionId: string, materials: PositionMaterial[]): void;
  reindexRecord(record: InterviewRecord): void;
  retrieve(query: string, options?: { positionId?: string; limit?: number }): { items: RetrievedChunk[]; run: RetrievalRun };
}

export function createRagRuntime(db: AppDb, resolveOwnerKey: () => string, resolveUserId: () => string | undefined): RagRuntime {
  return {
    reindexProfile(profile) {
      const now = nowIso();
      const document = createDocument({
        ownerKey: resolveOwnerKey(),
        positionId: "",
        sourceType: "resume",
        sourceId: "profile:resume",
        sourceSubType: "profile",
        title: profile.displayName || profile.resume.name || "候选人简历",
        summary: `${profile.resume.targetRole || "目标岗位待补充"} · ${profile.highlights.slice(0, 3).join("；")}`,
        content: buildResumeContent(profile),
        priority: 30,
        now,
      });
      persistDocument(db, document, buildChunks(document));
    },
    reindexPosition(position) {
      const now = nowIso();
      const document = createDocument({
        ownerKey: resolveOwnerKey(),
        positionId: position.id,
        sourceType: "jd",
        sourceId: position.id,
        sourceSubType: "intake",
        title: `${position.company} ${position.title}`.trim(),
        summary: position.matchReport.summary || "岗位 intake",
        content: buildPositionContent(position),
        priority: 50,
        now,
      });
      persistDocument(db, document, buildChunks(document));
      this.reindexMaterials(position.id, position.materials);
      this.reindexQuestions(position.id, position.questions);
    },
    reindexQuestions(positionId, questions) {
      const ownerKey = resolveOwnerKey();
      db.deleteDocumentsBySource("question", positionId, ownerKey);
      questions.forEach((question, index) => {
        const now = nowIso();
        const document = createDocument({
          ownerKey,
          positionId,
          sourceType: "question",
          sourceId: question.id,
          sourceSubType: question.priority ? "priority" : "default",
          title: question.question,
          summary: `${question.category} · ${question.reason || "用户保存问题"}`,
          content: buildQuestionContent(question),
          priority: question.priority ? 95 - index : 70 - index,
          now,
        });
        persistDocument(db, document, buildChunks(document));
      });
    },
    reindexMaterials(positionId, materials) {
      const ownerKey = resolveOwnerKey();
      db.deleteDocumentsBySource("material", positionId, ownerKey);
      materials.forEach((material, index) => {
        const now = nowIso();
        const document = createDocument({
          ownerKey,
          positionId,
          sourceType: "material",
          sourceId: material.id,
          sourceSubType: material.kind,
          title: material.title,
          summary: material.summary || material.detail.slice(0, 120),
          content: buildMaterialContent(material),
          priority: material.kind === "project" ? 120 - index : material.kind === "upload" ? 80 - index : 60 - index,
          now,
        });
        persistDocument(db, document, buildChunks(document));
      });
    },
    reindexRecord(record) {
      const now = nowIso();
      const document = createDocument({
        ownerKey: resolveOwnerKey(),
        positionId: record.positionId,
        sourceType: "record",
        sourceId: record.id,
        sourceSubType: record.mode,
        title: record.title,
        summary: record.summary,
        content: buildRecordContent(record),
        priority: 40,
        now,
      });
      persistDocument(db, document, buildChunks(document));
    },
    retrieve(query, options) {
      const started = Date.now();
      const raw = db.searchRagChunks(query, options?.positionId, resolveOwnerKey());
      const reranked = rerankChunks(raw, options?.positionId).slice(0, options?.limit ?? MAX_RETRIEVAL);
      const run: RetrievalRun = {
        id: makeId("retrieval"),
        query,
        positionId: options?.positionId,
        ownerKey: resolveOwnerKey(),
        chunkIds: reranked.map((item) => item.id),
        latencyMs: Date.now() - started,
        createdAt: nowIso(),
      };
      db.saveRetrievalRun(run, resolveUserId());
      return { items: reranked, run };
    },
  };
}

function createDocument(input: {
  ownerKey: string;
  positionId?: string;
  sourceType: RagSourceType;
  sourceId: string;
  sourceSubType?: string;
  title: string;
  summary: string;
  content: string;
  priority: number;
  now: string;
}): RagDocument {
  return {
    id: `${input.ownerKey}:${input.sourceType}:${input.sourceId}`,
    positionId: input.positionId || undefined,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceSubType: input.sourceSubType,
    ownerKey: input.ownerKey,
    title: input.title,
    summary: input.summary,
    content: input.content,
    priority: input.priority,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function persistDocument(db: AppDb, document: RagDocument, chunks: RagChunk[]) {
  db.upsertDocument(document);
  db.replaceDocumentChunks(document.id, chunks);
}

function buildChunks(document: RagDocument): RagChunk[] {
  const normalized = normalizeChunkText(document.content);
  if (!normalized) return [];
  const slices = splitIntoChunks(normalized);
  const now = document.updatedAt;
  return slices.map((content, index) => ({
    id: makeId(`chunk-${document.sourceType}`),
    documentId: document.id,
    positionId: document.positionId,
    sourceType: document.sourceType,
    sourceId: document.sourceId,
    sourceSubType: document.sourceSubType,
    ownerKey: document.ownerKey,
    title: document.title,
    content,
    chunkIndex: index,
    priority: document.priority,
    createdAt: now,
    updatedAt: now,
  }));
}

function splitIntoChunks(content: string): string[] {
  if (content.length <= CHUNK_TARGET) return [content];
  const sentences = content.split(/(?<=[。！？\n])/).map((item) => item.trim()).filter(Boolean);
  if (!sentences.length) return [content];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > CHUNK_TARGET && current) {
      chunks.push(current.trim());
      const overlap = current.slice(Math.max(0, current.length - CHUNK_OVERLAP));
      current = `${overlap}${sentence}`.trim();
      continue;
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function normalizeChunkText(content: string): string {
  return content.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function buildResumeContent(profile: CandidateProfile): string {
  return [
    `姓名：${profile.displayName || profile.resume.name || "候选人"}`,
    `目标岗位：${profile.resume.targetRole || "待补充"}`,
    `简历摘要：${profile.resume.summary || "待补充"}`,
    `亮点：${profile.highlights.join("；")}`,
    ...profile.evidenceLibrary.map((item) => `证据[${item.type}] ${item.title}\n细节：${item.detail}\n影响：${item.impact}\n关键词：${item.keywords.join("、")}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildPositionContent(position: Position): string {
  return [
    `公司：${position.company || "待补充"}`,
    `岗位：${position.title || "待补充"}`,
    `原始 JD：${position.intake.rawJdText || position.jobText || "待补充"}`,
    `系统推断：${position.intake.inferredFields.map((item) => `${item.label}:${item.value}`).join("；")}`,
    `用户确认：${position.intake.confirmedFields.map((item) => `${item.label}:${item.value}`).join("；")}`,
    `缺失字段：${position.intake.missingFields.map((item) => item.label).join("、")}`,
    `岗位职责：${position.job.responsibilities.join("；")}`,
    `硬技能：${position.job.hardSkills.join("、")}`,
    `软技能：${position.job.softSkills.join("、")}`,
    `关键词：${position.job.keywords.join("、")}`,
    `匹配总结：${position.matchReport.summary}`,
    `准备重点：${position.analysisContext.preparationTips.join("；")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildMaterialContent(material: PositionMaterial): string {
  return [
    `资料类型：${material.kind}`,
    `资料来源：${material.source}`,
    `标题：${material.title}`,
    `摘要：${material.summary}`,
    `正文：${material.detail}`,
    `关键词：${material.keywords.join("、")}`,
    `标签：${material.tags.join("、")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildQuestionContent(question: InterviewQuestion): string {
  return [
    `问题：${question.question}`,
    `题型：${question.category}`,
    `难度：${question.difficulty}`,
    `理由：${question.reason}`,
    `备注：${question.notes}`,
    `参考回答：${question.answer ?? ""}`,
    `标签：${question.tags?.join("、") ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildRecordContent(record: InterviewRecord): string {
  return [
    `记录标题：${record.title}`,
    `总结：${record.summary}`,
    `报告摘要：${record.report.summary}`,
    `改进建议：${record.report.improvementPoints?.join("；") ?? record.report.nextActions.join("；")}`,
    `转写：${record.transcript.map((item) => `${item.role === "candidate" ? "候选人" : "面试官"}：${item.text}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function rerankChunks(items: RetrievedChunk[], positionId?: string): RetrievedChunk[] {
  const priorities: RetrievalPriority = {
    "material:project": 500,
    "question:priority": 420,
    "material:upload": 340,
    resume: 260,
    record: 180,
    jd: 140,
    "material:note": 120,
    "question:default": 300,
  };
  const grouped = new Map<string, number>();
  const ranked: RankedChunk[] = items
    .map((item) => {
      const key = `${item.sourceType}:${item.sourceSubType ?? ""}`;
      const baseKey =
        item.sourceType === "material"
          ? `material:${item.sourceSubType === "project" || item.sourceSubType === "upload" || item.sourceSubType === "note" ? item.sourceSubType : "note"}`
          : item.sourceType === "question"
            ? `question:${item.priority >= 90 ? "priority" : "default"}`
            : item.sourceType;
      const positionBoost = positionId && item.positionId === positionId ? 120 : 0;
      const score = (priorities[baseKey] ?? 100) + positionBoost + item.priority - item.score;
      return { ...item, score, _groupKey: key };
    })
    .sort((a, b) => b.score - a.score);

  const final: RetrievedChunk[] = [];
  for (const item of ranked) {
    const count = grouped.get(item._groupKey) ?? 0;
    if (count >= SAME_SOURCE_LIMIT) continue;
    grouped.set(item._groupKey, count + 1);
    final.push(stripGroupKey(item));
    if (final.length >= MAX_RETRIEVAL) break;
  }
  return final;
}

function stripGroupKey(item: RetrievedChunk & { _groupKey?: string }): RetrievedChunk {
  const rest = { ...item };
  delete rest._groupKey;
  return rest;
}
