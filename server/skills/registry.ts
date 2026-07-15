export interface SkillDefinition {
  id: string;
  purpose: string;
  promptIds: string[];
  needsRag: boolean;
  allowSearch: boolean;
  latencyTargetMs: number;
  active: boolean;
}

export const skills = {
  jdIntakeNormalizer: {
    id: "jd_intake_normalizer",
    purpose: "基于原始 JD、已确认字段与消息流，生成下一轮 intake 追问和缺失字段引导。",
    promptIds: ["jd.intake.followup.v1"],
    needsRag: false,
    allowSearch: false,
    latencyTargetMs: 2500,
    active: true,
  },
  jdMatchDiagnosis: {
    id: "jd_match_diagnosis",
    purpose: "输出 JD 与当前候选人证据的匹配诊断、风险与准备重点。",
    promptIds: ["jd.match-diagnosis.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 4000,
    active: true,
  },
  resumeEvidenceExtractor: {
    id: "resume_evidence_extractor",
    purpose: "从简历原文抽取结构化证据卡，用于后续优化和问答 grounding。",
    promptIds: ["resume.evidence.v1"],
    needsRag: false,
    allowSearch: false,
    latencyTargetMs: 3000,
    active: false,
  },
  resumeOptimizer: {
    id: "resume_optimizer",
    purpose: "基于岗位与用户现有证据，生成 section/full/match 三类简历优化建议。",
    promptIds: ["resume.chat.v1", "resume.highlights.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 3500,
    active: true,
  },
  questionBankGenerator: {
    id: "question_bank_generator",
    purpose: "生成岗位相关的训练题库与材料深挖问题。",
    promptIds: [],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 3000,
    active: false,
  },
  liveCueCardCoach: {
    id: "live_cue_card_coach",
    purpose: "针对实时识别的问题生成提词卡，不代答，只给结构、证据与风险提醒。",
    promptIds: ["copilot.cue-card.v1"],
    needsRag: true,
    allowSearch: true,
    latencyTargetMs: 2000,
    active: true,
  },
  cueCardRewriter: {
    id: "cue_card_rewriter",
    purpose: "根据反馈重构已有提词卡，保留可用内容并定向调整。",
    promptIds: ["copilot.cue-card.reconstruct.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 2000,
    active: true,
  },
  mockInterviewer: {
    id: "mock_interviewer",
    purpose: "为当前岗位和人格设定生成模拟面试首题。",
    promptIds: ["mock.interviewer.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 2200,
    active: true,
  },
  followupDecider: {
    id: "followup_decider",
    purpose: "根据候选人回答判断追问还是切题，并给即时反馈。",
    promptIds: ["mock.decision.v1", "copilot.follow-up.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 2500,
    active: true,
  },
  reportScorer: {
    id: "report_scorer",
    purpose: "基于 transcript 和回合评价输出结构化面试报告。",
    promptIds: ["record.report.v1"],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 3000,
    active: true,
  },
  companyRoleResearcher: {
    id: "company_role_researcher",
    purpose: "对联网搜索结果做岗位/公司摘要，仅用于补充时效性事实。",
    promptIds: ["search.summary.v1"],
    needsRag: false,
    allowSearch: true,
    latencyTargetMs: 3000,
    active: true,
  },
  ragGroundingChecker: {
    id: "rag_grounding_checker",
    purpose: "检查输出和已检索证据是否一致，避免无关片段与编造引用。",
    promptIds: [],
    needsRag: true,
    allowSearch: false,
    latencyTargetMs: 2500,
    active: false,
  },
} satisfies Record<string, SkillDefinition>;

export type SkillId = (typeof skills)[keyof typeof skills]["id"];

export function getSkillById(skillId: string): SkillDefinition | undefined {
  return Object.values(skills).find((skill) => skill.id === skillId);
}
