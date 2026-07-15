import type { LucideIcon } from "lucide-react";
import { BookOpenCheck, Check, ClipboardList, GraduationCap, RefreshCw, Target, UserRound } from "lucide-react";
import { generateHighlightsLocal } from "../lib/coach";
import type {
  CandidateProfile,
  EvidenceType,
  InterviewDifficulty,
  InterviewPreferences,
  InterviewStyle,
  InterviewSubmitMode,
  InterviewerRole,
} from "../types";

export type PersonaKey = InterviewStyle;

export type InterviewConfig = {
  interviewerRole: InterviewerRole;
  difficulty: InterviewDifficulty;
  interviewerGender: "女" | "男";
  submitMode: InterviewSubmitMode;
  style: PersonaKey;
};

export type PersonaDefinition = {
  id: PersonaKey;
  label: string;
  description: string;
  avatar: string;
};

export const PERSONAS: PersonaDefinition[] = [
  { id: "gentle", label: "温和鼓励型", description: "先给肯定和结构建议，适合建立表达信心。", avatar: "温" },
  { id: "strict", label: "专业严格型", description: "更关注逻辑、证据和表达漏洞。", avatar: "严" },
  { id: "pressure", label: "压力测试型", description: "追问更尖锐，适合高压模拟。", avatar: "压" },
];

export type SpeechCaptureState = "idle" | "listening" | "paused" | "finalizing" | "ready" | "generating" | "error";
export type RealtimeSubmitMode = InterviewSubmitMode;
export type RecognizedDraft = { interimText: string; finalText: string; editableText: string; lastFinalAt: number };
export type ResumeSectionId = "basic" | "education" | "work" | "projects" | "highlights" | "skills" | "extra";
export type ResumeChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  sectionId?: ResumeSectionId;
  suggestion?: string;
  applyTarget?: "section" | "full";
  evidenceTrace?: Array<{ id: string; title: string; reason: string; synthetic?: boolean }>;
  metaNote?: string;
  status?: AiStatusKind;
};
export type AiStatusKind = "success" | "fallback" | "generating" | "error";
export type AiProgressItem = { id: string; label: string; detail?: string; status?: "running" | "done" | "success" | "fallback" | "error" };

export const DEFAULT_CONFIG: InterviewConfig = {
  interviewerRole: "上级",
  difficulty: "压力面",
  interviewerGender: "女",
  submitMode: "manual",
  style: "gentle",
};

export function configFromPreferences(preferences?: Partial<InterviewPreferences>): InterviewConfig {
  return {
    interviewerRole: preferences?.interviewerRole ?? DEFAULT_CONFIG.interviewerRole,
    difficulty: preferences?.difficulty ?? DEFAULT_CONFIG.difficulty,
    interviewerGender: preferences?.interviewerGender ?? DEFAULT_CONFIG.interviewerGender,
    submitMode: preferences?.submitMode ?? DEFAULT_CONFIG.submitMode,
    style: preferences?.style ?? DEFAULT_CONFIG.style,
  };
}

export function preferencesFromConfig(config: InterviewConfig): InterviewPreferences {
  return {
    interviewerRole: config.interviewerRole,
    difficulty: config.difficulty,
    interviewerGender: config.interviewerGender,
    submitMode: config.submitMode,
    style: config.style,
  };
}

export function buildResumeSections(profile: CandidateProfile): Array<{ id: ResumeSectionId; label: string; title: string; content: string; icon: LucideIcon }> {
  const formatEvidence = (items: typeof profile.evidenceLibrary) =>
    items
      .map((item) => [item.title, item.detail, item.impact].filter(Boolean).join("\n"))
      .join("\n\n");

  const evidenceByType = (type: EvidenceType) => formatEvidence(profile.evidenceLibrary.filter((item) => item.type === type));
  const educationLines = profile.resumeText
    .split(/\n/)
    .filter((line) => /大学|学院|本科|硕士|博士|GPA|教育/.test(line))
    .join("\n");
  const workEvidence = profile.evidenceLibrary.filter((item) => item.type === "实习");
  const projectEvidence = profile.evidenceLibrary.filter((item) => item.type === "项目" || item.type === "成果");
  const matchedEvidenceIds = new Set([...workEvidence, ...projectEvidence].map((item) => item.id));
  const extraEvidence = profile.evidenceLibrary.filter((item) => !matchedEvidenceIds.has(item.id) && item.type !== "教育" && item.type !== "技能");
  const extraBlocks = [formatEvidence(extraEvidence), profile.resume.risks.join("\n")].filter((block) => block.trim().length > 0);

  return [
    {
      id: "basic",
      label: "个人信息",
      title: "个人信息",
      content: [profile.resume.name, profile.resume.targetRole, profile.resume.summary].filter(Boolean).join("\n"),
      icon: UserRound,
    },
    {
      id: "education",
      label: "教育经历",
      title: "教育经历",
      content: evidenceByType("教育") || educationLines,
      icon: GraduationCap,
    },
    {
      id: "work",
      label: "工作经历",
      title: "工作经历",
      content: formatEvidence(workEvidence) || formatEvidence(profile.evidenceLibrary.slice(0, 2)),
      icon: ClipboardList,
    },
    {
      id: "projects",
      label: "项目经历",
      title: "项目经历",
      content: formatEvidence(projectEvidence) || formatEvidence(profile.evidenceLibrary),
      icon: Target,
    },
    {
      id: "highlights",
      label: "亮点总结",
      title: "亮点总结",
      content: profile.highlights.length ? profile.highlights.join("\n") : generateHighlightsLocal(profile).join("\n"),
      icon: Check,
    },
    { id: "skills", label: "技能", title: "技能", content: profile.resume.skills.join("、"), icon: BookOpenCheck },
    { id: "extra", label: "补充内容", title: "补充内容", content: extraBlocks.join("\n\n") || "等待补充内容", icon: RefreshCw },
  ];
}

export function sectionsToDrafts(sections: Array<{ id: ResumeSectionId; content: string }>): Record<ResumeSectionId, string> {
  return sections.reduce(
    (acc, section) => ({ ...acc, [section.id]: section.content }),
    { basic: "", education: "", work: "", projects: "", highlights: "", skills: "", extra: "" },
  );
}

export function resolveEvidenceType(sectionId: ResumeSectionId): EvidenceType {
  if (sectionId === "education") return "教育";
  if (sectionId === "skills") return "技能";
  if (sectionId === "work") return "实习";
  return "项目";
}

export function buildResumeSuggestion(title: string, content: string, profile: CandidateProfile): string {
  const metrics = profile.resume.metrics.slice(0, 3).join("、") || "可验证指标";
  const skills = profile.resume.skills.slice(0, 5).join("、") || "岗位核心能力";
  const clean = content.replace(/\s+/g, " ").trim();
  return [
    `${title}优化版：`,
    `1. 先给一句结论，明确你具备 ${skills} 相关能力。`,
    `2. 再补真实动作：${clean.slice(0, 180) || profile.evidenceLibrary[0]?.detail || "补充一段最相关经历"}。`,
    `3. 最后用 ${metrics} 这类指标说明结果，避免只有职责没有产出。`,
  ].join("\n");
}

