import {
  AnswerDraft,
  AnswerCueCard,
  AppState,
  CandidateProfile,
  EvidenceItem,
  InterviewPreferences,
  InterviewQuestion,
  InterviewReport,
  JobAnalysis,
  MatchReport,
  MockTurn,
  Position,
  PositionAnalysisContext,
  PositionIntakeFieldDefinition,
  PositionIntakeFieldKey,
  PositionIntakeFieldSource,
  PositionIntakeFieldValue,
  PositionIntakeState,
  PositionMaterial,
  QuestionCategory,
  ResumeAnalysis,
  RewriteSuggestion,
  WorkspaceState,
} from "../types";
import { clamp, extractKeywords, findMetrics, normalizeText, scoreOverlap, sentenceIncludesAny, splitLines, unique } from "./text";
import { sampleJob, sampleResume } from "../data/sampleInputs";
import { cacheKey, getCachedCueCard, setCachedCueCard } from "./cueCardCache";

const HARD_SKILL_HINTS = [
  "SQL",
  "Excel",
  "BI",
  "Python",
  "Java",
  "Spring",
  "MySQL",
  "Redis",
  "Linux",
  "A/B",
  "前端",
  "React",
  "Vue",
  "TypeScript",
  "JavaScript",
  "HTML",
  "CSS",
  "Node",
  "数据分析",
  "用户访谈",
  "社群运营",
  "内容运营",
  "活动运营",
  "增长",
  "产品",
  "AI",
  "HRTech",
  "飞书",
  "多维表格",
  "分布式",
];

const SOFT_SKILL_HINTS = ["表达", "执行力", "协作", "复盘", "沟通", "学习", "抗压", "主动", "清晰"];

export function analyzeResume(text: string): ResumeAnalysis {
  const normalized = normalizeText(text);
  const lines = splitLines(normalized);
  const metrics = findMetrics(normalized);
  const keywords = extractKeywords(normalized, 40);
  const name = lines[0]?.replace(/[^\u4e00-\u9fa5A-Za-z]/g, "") || "候选人";
  const targetRole = inferTargetRole(normalized);
  const evidence = buildEvidence(lines, keywords, metrics);
  const skills = unique(HARD_SKILL_HINTS.filter((skill) => normalized.toLowerCase().includes(skill.toLowerCase())).concat(keywords.slice(0, 8)));
  const risks = buildResumeRisks(normalized, evidence, metrics);

  return {
    name,
    targetRole,
    summary: `${name}具备${skills.slice(0, 4).join("、") || "相关能力"}经历，适合围绕目标岗位做证据化表达训练。`,
    evidence,
    skills,
    metrics,
    risks,
  };
}

export function analyzeJob(text: string): JobAnalysis {
  const normalized = normalizeText(text);
  const lines = splitLines(normalized);
  const title =
    inferJobTitle(lines, normalized) ||
    inferRoleFromText(normalized) ||
    "目标岗位";
  const company = inferCompany(lines, normalized) || "目标公司";
  const responsibilities = lines.filter((line) => /^\d+[.、]/.test(line) || line.includes("负责") || line.includes("协助")).slice(0, 8);
  const hardSkills = unique(HARD_SKILL_HINTS.filter((skill) => normalized.toLowerCase().includes(skill.toLowerCase())));
  const softSkills = unique(SOFT_SKILL_HINTS.filter((skill) => normalized.includes(skill)));
  const keywords = extractKeywords(normalized, 34);
  const hiddenSignals = buildHiddenSignals(normalized, hardSkills, softSkills);

  return {
    title,
    company,
    responsibilities,
    hardSkills,
    softSkills,
    hiddenSignals,
    keywords,
  };
}

export function createMatchReport(resume: ResumeAnalysis, job: JobAnalysis, resumeText: string): MatchReport {
  const resumeKeywords = extractKeywords(resumeText, 60).concat(resume.skills);
  const keywordCoverage = scoreOverlap(resumeKeywords, job.keywords.slice(0, 24));
  const hardSkillCoverage = scoreOverlap(resumeKeywords, job.hardSkills);
  const metricBonus = resume.metrics.length >= 3 ? 12 : resume.metrics.length >= 1 ? 6 : 0;
  const evidenceBonus = Math.min(resume.evidence.length * 3, 15);
  const riskPenalty = resume.risks.length * 5;
  const score = clamp(Math.round(keywordCoverage * 0.46 + hardSkillCoverage * 0.26 + metricBonus + evidenceBonus - riskPenalty + 18), 28, 96);
  const atsScore = clamp(Math.round(keywordCoverage * 0.68 + hardSkillCoverage * 0.22 + metricBonus), 20, 98);
  const gaps = buildGaps(resume, job, resumeKeywords);
  const rewriteSuggestions = buildRewriteSuggestions(resume, job, resumeText);

  return {
    score,
    summary:
      score >= 78
        ? "简历与目标岗位有较强相关性，下一步应强化岗位动机和项目复盘表达。"
        : score >= 58
          ? "简历具备部分岗位证据，但关键词覆盖和成果表达还需要补强。"
          : "当前简历与岗位要求距离较大，建议先补齐核心技能和可量化经历。",
    keywordCoverage,
    atsScore,
    gaps,
    rewriteSuggestions,
  };
}

export function generateQuestions(resume: ResumeAnalysis, job: JobAnalysis, count = 24): InterviewQuestion[] {
  const questions: InterviewQuestion[] = [];
  const evidence = resume.evidence.length > 0 ? resume.evidence : fallbackEvidence(resume);
  const prioritizedEvidence = prioritizeEvidenceForJob(resume, job, evidence);
  const add = (
    category: QuestionCategory,
    question: string,
    reason: string,
    evidenceIds: string[],
    difficulty: InterviewQuestion["difficulty"] = "基础",
  ) => {
    questions.push({
      id: `q-${questions.length + 1}`,
      category,
      question,
      reason,
      evidenceIds,
      difficulty,
      source: "diagnosis",
      priority: difficulty !== "基础" || category === "项目深挖",
      notes: "",
    });
  };

  prioritizedEvidence.slice(0, 4).forEach((item) => {
    add("项目深挖", `请你详细介绍一下「${item.title}」，你具体负责什么，最后结果如何？`, "JD 会关注经历真实性和个人贡献边界。", [item.id], "基础");
    add("行为面", `这个经历里最困难的一次协作或推进是什么，你怎么处理？`, "校招面试常用同一段经历追问执行力和沟通。", [item.id], "进阶");
  });

  job.hardSkills.slice(0, 6).forEach((skill) => {
    const relatedEvidence = findEvidenceForKeyword(evidence, skill);
    add("专业技能", `你在过往经历中如何使用「${skill}」解决实际问题？`, `JD 明确提到 ${skill}，需要用真实场景证明。`, [relatedEvidence.id], "基础");
  });

  add("岗位动机", `为什么想做「${job.title}」，你对 ${job.company} 这类业务的理解是什么？`, "岗位动机是校招高频题，能区分海投和认真准备。", prioritizedEvidence.slice(0, 2).map((item) => item.id), "基础");
  add("岗位动机", "如果入职前三个月只能优化一个指标，你会选什么，为什么？", "目标感要和岗位职责、能力证据一起讲。", prioritizedEvidence.slice(0, 2).map((item) => item.id), "进阶");
  add("压力题", "你简历里最薄弱的一段经历是什么？如果面试官质疑含金量，你会怎么回应？", "提前处理弱点能降低正式面试的失误率。", prioritizedEvidence.slice(0, 2).map((item) => item.id), "压力");
  add("压力题", "如果你的方案上线后数据没有提升，你会如何复盘？", "失败复盘比成功叙事更能体现成熟度。", prioritizedEvidence.slice(0, 2).map((item) => item.id), "压力");
  add("英文题", `Please introduce one project that proves you are a strong fit for the ${job.title} role.`, "部分岗位会穿插英文自我介绍或项目说明。", [prioritizedEvidence[0]?.id ?? evidence[0].id], "进阶");
  add("英文题", "What is your biggest learning from a user research or operations project?", "考察英文表达和对经历的结构化提炼。", [prioritizedEvidence[0]?.id ?? evidence[0].id], "进阶");

  job.hiddenSignals.slice(0, 4).forEach((signal) => {
    add("行为面", `请举例说明你如何体现「${signal}」。`, "隐性要求通常不会直接出题，但会在追问中出现。", [findEvidenceForKeyword(evidence, signal).id], "进阶");
  });

  return questions.slice(0, count);
}

export function generateAnswerDrafts(
  questions: InterviewQuestion[],
  resume: ResumeAnalysis,
  job: JobAnalysis,
  evidenceSource: EvidenceItem[] = resume.evidence,
): AnswerDraft[] {
  return questions.map((question) => {
    const evidence = resolveEvidence(question.evidenceIds, evidenceSource);
    const primary = evidence[0] ?? fallbackEvidence(resume)[0];
    const metrics = resume.metrics.slice(0, 2).join("、") || "明确的过程数据";

    return {
      questionId: question.id,
      speakable: `我会用「背景、任务、动作、结果」来回答。背景是我在${primary.title}中遇到与${job.title}相近的问题；任务是${primary.detail}。我主要做了三件事：先拆解目标和用户反馈，再用${resume.skills.slice(0, 3).join("、")}推进方案，最后用数据复盘结果。结果上，这段经历沉淀了${metrics}，也让我更确定自己适合这个岗位。`,
      concise: `我在${primary.title}中负责${primary.detail}，用${resume.skills.slice(0, 2).join("、")}推进，最终形成${primary.impact}。这和${job.title}要求的${job.hardSkills.slice(0, 2).join("、") || "岗位能力"}高度相关。`,
      followUp: `如果继续追问，我会补充两点：第一，我在这件事中的个人贡献边界；第二，如果重新做，我会更早设定对照组或复盘指标，避免只描述执行动作。`,
      evidenceIds: question.evidenceIds,
      caution: "不要编造没有发生过的数字；如果证据不足，用学习和复盘表达替代夸大承诺。",
    };
  });
}

export function evaluateMockTurn(question: InterviewQuestion, answer: string, draft?: AnswerDraft): MockTurn {
  const normalized = normalizeText(answer);
  const hasStructure = ["背景", "任务", "动作", "结果", "首先", "其次", "最后"].some((token) => normalized.includes(token));
  const hasMetric = findMetrics(normalized).length > 0;
  const hasEvidence = draft?.speakable
    .split(/[，。；]/)
    .filter((part) => part.length > 4)
    .some((part) => normalized.includes(part.slice(0, 4))) ?? false;
  const lengthScore = clamp(Math.round(normalized.length / 6), 8, 30);
  const score = clamp(lengthScore + (hasStructure ? 24 : 8) + (hasMetric ? 20 : 6) + (hasEvidence ? 18 : 10) + (question.difficulty === "压力" ? 6 : 10), 18, 96);

  return {
    questionId: question.id,
    answer,
    score,
    feedback:
      score >= 80
        ? "回答结构清楚，也能用证据支撑。正式面试中注意控制在 90 秒内。"
        : score >= 60
          ? "方向正确，但需要补充更明确的个人动作和结果数据。"
          : "回答还偏泛，建议先按 STAR 写出背景、动作、结果，再加入具体数字。",
  };
}

export function buildInterviewReport(turns: MockTurn[], questions: InterviewQuestion[], matchReport: MatchReport): InterviewReport {
  const average = turns.length > 0 ? Math.round(turns.reduce((sum, turn) => sum + turn.score, 0) / turns.length) : 0;
  const answeredRatio = questions.length > 0 ? turns.length / Math.min(questions.length, 6) : 0;
  const speechTurns = turns.filter((turn) => turn.speechMetrics);
  const avgPace =
    speechTurns.length > 0
      ? Math.round(speechTurns.reduce((sum, turn) => sum + (turn.speechMetrics?.charsPerMinute ?? 0), 0) / speechTurns.length)
      : 0;
  const fillerTotal = speechTurns.reduce((sum, turn) => sum + (turn.speechMetrics?.fillerCount ?? 0), 0);
  const conversationTurns = turns.reduce((sum, turn) => sum + (turn.transcript?.length ?? 0), 0);
  const dimensions = {
    completeness: clamp(Math.round(answeredRatio * 100), 20, 95),
    relevance: clamp(Math.round(matchReport.score * 0.82 + average * 0.18), 30, 96),
    evidenceStrength: clamp(Math.round(average * 0.76 + matchReport.keywordCoverage * 0.24), 24, 95),
    structure: clamp(Math.round(average * 0.9), 20, 94),
    riskControl: clamp(88 - Math.max(0, 6 - turns.length) * 5, 45, 92),
  };
  const overallScore =
    turns.length === 0
      ? Math.round(matchReport.score * 0.55)
      : Math.round(
          dimensions.completeness * 0.16 +
            dimensions.relevance * 0.22 +
            dimensions.evidenceStrength * 0.22 +
            dimensions.structure * 0.22 +
            dimensions.riskControl * 0.18,
        );

  return {
    overallScore,
    dimensions,
    summary:
      turns.length === 0
        ? "还没有完成模拟面试。先回答 3 到 6 道高优先级问题，系统会生成更稳定的复盘结论。"
        : overallScore >= 78
          ? `你已经具备较好的岗位相关表达，下一步应压缩冗余并准备追问。${conversationTurns > turns.length ? "本轮已包含多轮追问记录。" : ""}`
          : `当前回答能覆盖基本信息，但岗位证据、量化结果和结构化表达仍需加强。${speechTurns.length > 0 ? `语音练习平均语速约 ${avgPace} 字/分钟。` : ""}`,
    nextActions: [
      "把匹配诊断中的缺口补成 2 段真实经历或学习计划。",
      "优先练习项目深挖和压力题，每题控制在 60 到 90 秒。",
      "为每个核心技能准备一个可验证的数字或产出物。",
      "复盘所有没有数字的回答，补充过程指标或结果指标。",
      ...(fillerTotal >= 4 ? ["减少“嗯/那个”等填充词，把停顿留给结构转场。"] : []),
    ],
  };
}

export function generateCueCard(
  questionText: string,
  profile: CandidateProfile,
  position: Position,
  questionBank: InterviewQuestion[] = position.questions,
  source: AnswerCueCard["source"] = "live",
): AnswerCueCard {
  const key = cacheKey(questionText, position.id);
  const cached = getCachedCueCard(key);
  if (cached) return cached;

  const normalizedQuestion = normalizeText(questionText);
  const resumeWithLibrary = withEvidenceLibrary(profile);
  const evidence = pickEvidenceForQuestionFast(normalizedQuestion, resumeWithLibrary.evidence, position.job.keywords);
  const resolvedEvidence = evidence.length > 0 ? evidence : fallbackEvidence(profile.resume);
  const relatedQuestion = questionBank.find(
    (question) =>
      normalizedQuestion.includes(question.question.slice(0, 8)) ||
      question.question.includes(normalizedQuestion.slice(0, 8)) ||
      question.evidenceIds.some((id) => resolvedEvidence.some((item) => item.id === id)),
  );
  const firstEvidence = resolvedEvidence[0] ?? resumeWithLibrary.evidence[0] ?? fallbackEvidence(profile.resume)[0];
  const skills = unique([...position.job.hardSkills, ...position.job.softSkills, ...profile.resume.skills]).slice(0, 4);
  const metrics = profile.resume.metrics.slice(0, 2);
  const strategy =
    relatedQuestion?.category === "压力题"
      ? "先承认边界，再用事实澄清贡献，最后给复盘动作。"
      : relatedQuestion?.category === "岗位动机"
        ? "把岗位关键词、个人经历和入职后能贡献的指标连起来。"
        : "用结论先行，再按背景、动作、结果补充证据。";

  const card: AnswerCueCard = {
    id: makeId("cue"),
    questionText: questionText.trim() || relatedQuestion?.question || `请结合 ${position.title} 说明你的相关经历。`,
    createdAt: nowIso(),
    source,
    strategy,
    openingLine: `我会优先结合「${firstEvidence.title}」这段经历来回答，因为它和 ${position.title} 里的关键要求有直接关系。`,
    bullets: [
      `先点题：这段经历对应 JD 里的 ${skills.slice(0, 2).join("、") || "核心能力"}。`,
      `讲个人动作：突出你在「${firstEvidence.title}」中直接负责的拆解、推进和协作。`,
      `补结果证据：${metrics.length > 0 ? `带上 ${metrics.join("、")} 这类数据。` : firstEvidence.impact}`,
      "收尾回到岗位：说明这段经验如何迁移到当前团队的业务目标。",
    ].slice(0, 5),
    evidenceIds: resolvedEvidence.map((item) => item.id).slice(0, 3),
    risks: [
      "不要把团队成果说成个人独立完成。",
      "没有数字时不要硬编，改说过程指标、样本量或复盘结论。",
      ...(position.matchReport.gaps.find((gap) => gap.type === "risk") ? [position.matchReport.gaps.find((gap) => gap.type === "risk")!.description] : []),
    ].slice(0, 3),
    followUps: [
      "这件事里你最关键的个人贡献是什么？",
      "如果结果没有达到预期，你会怎么复盘？",
      `和 ${position.title} 这份 JD 里的哪条要求最相关？`,
    ],
  };
  setCachedCueCard(key, card);
  return card;
}

export function generateFollowUpFromTranscript(transcript: Array<{ role: "interviewer" | "candidate"; text: string }>, profile: CandidateProfile, position: Position): string {
  const lastAnswer = [...transcript].reverse().find((message) => message.role === "candidate")?.text ?? "";
  if (!/\d/.test(lastAnswer)) return "刚才这段回答还缺少结果数据。你能补一个最能证明效果的指标吗？";
  if (!/(我|本人|自己|负责|主导|协助)/.test(lastAnswer)) return "你在这段经历里的个人贡献边界是什么？哪些是你直接推动的？";
  const skill = position.job.hardSkills[0] ?? profile.resume.skills[0] ?? "岗位核心能力";
  return `如果继续追问 ${skill}，你会用哪个项目细节证明自己真的做过？`;
}

export function saveQuestionFromCueCard(card: AnswerCueCard): InterviewQuestion {
  return {
    id: makeId("q-cue"),
    category: "项目深挖",
    question: card.questionText,
    reason: "由实时助手/模拟面试中的提词卡沉淀，适合面试后复盘。",
    evidenceIds: card.evidenceIds,
    difficulty: "进阶",
    source: card.source === "mock" ? "mock" : "manual",
    priority: true,
    notes: card.bullets.join("\n"),
    lastReviewedAt: nowIso(),
    cueCardIds: [card.id],
  };
}

export function createWorkspaceState(resumeText = sampleResume, jobText = sampleJob): WorkspaceState {
  const resume = analyzeResume(resumeText);
  const job = analyzeJob(jobText);
  const matchReport = createMatchReport(resume, job, resumeText);
  const questions = generateQuestions(resume, job, 28);
  const answers = generateAnswerDrafts(questions, resume, job);
  const mockTurns: MockTurn[] = [];
  const report = buildInterviewReport(mockTurns, questions, matchReport);

  return {
    resumeText,
    jobText,
    resume,
    job,
    matchReport,
    questions,
    answers,
    mockTurns,
    report,
    selectedQuestionId: questions[0]?.id ?? "",
  };
}

export function recomputeWorkspace(resumeText: string, jobText: string, existingTurns: MockTurn[] = []): WorkspaceState {
  const resume = analyzeResume(resumeText);
  const job = analyzeJob(jobText);
  const matchReport = createMatchReport(resume, job, resumeText);
  const questions = generateQuestions(resume, job, 28);
  const answers = generateAnswerDrafts(questions, resume, job);
  const validTurns = existingTurns.filter((turn) => questions.some((question) => question.id === turn.questionId));
  const report = buildInterviewReport(validTurns, questions, matchReport);

  return {
    resumeText,
    jobText,
    resume,
    job,
    matchReport,
    questions,
    answers,
    mockTurns: validTurns,
    report,
    selectedQuestionId: questions[0]?.id ?? "",
  };
}

function inferTargetRole(text: string): string {
  return inferRoleFromText(text) || "校招目标岗位";
}

function inferRoleFromText(text: string): string | undefined {
  const roles = ["产品运营", "增长运营", "AI 产品运营", "产品经理", "数据分析", "前端开发", "后端开发", "算法工程师", "市场运营"];
  return roles.find((role) => text.includes(role));
}

function inferValue(lines: string[], label: string): string | undefined {
  const variants = buildLabelVariants(label);

  for (const item of lines) {
    const inline = extractInlineLabelValue(item, variants);
    if (inline) return inline;
  }

  return undefined;
}

function buildLabelVariants(label: string): string[] {
  if (label === "岗位") {
    return ["岗位", "岗位名称", "目标岗位", "招聘岗位", "职位", "职位名称", "应聘岗位"];
  }
  if (label === "公司") {
    return ["公司", "公司名称", "目标公司", "招聘公司", "企业", "单位"];
  }
  return [label];
}

function extractInlineLabelValue(line: string, labels: string[]): string | undefined {
  const normalizedLine = line.replace(/\s+/g, " ").trim();
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const regex = new RegExp(`(?:^|\\s|[|｜/，,、；;])${escaped}\\s*[：:]\\s*([^\\n|｜/，,、；;]+?)\\s*(?=(?:${labels.map(escapeRegExp).join("|")})\\s*[：:]|$)`);
    const match = normalizedLine.match(regex);
    const value = sanitizeLabeledValue(match?.[1]);
    if (value) return value;
  }
  return undefined;
}

function sanitizeLabeledValue(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[。；;,，]+$/g, "")
    .replace(/^(为|是)\s*/, "")
    .trim();
  if (!cleaned) return undefined;
  if (cleaned.length > 40) return undefined;
  if (/(职责|要求|描述|介绍|负责|协助)/.test(cleaned)) return undefined;
  return cleaned;
}

function inferJobTitle(lines: string[], normalized: string): string | undefined {
  const labeled = inferValue(lines, "岗位");
  if (labeled) return labeled;

  const firstMatchedRole = inferRoleFromText(normalized);
  if (firstMatchedRole) return firstMatchedRole;

  const lineCandidate = lines.find((line) => /(?:招聘|招募|诚聘).{0,12}(?:产品|运营|开发|工程师|分析|设计)/.test(line));
  if (!lineCandidate) return undefined;
  const match = lineCandidate.match(/(?:招聘|招募|诚聘)\s*([^\n，。,；;]{2,24})/);
  return sanitizeLabeledValue(match?.[1]);
}

function inferCompany(lines: string[], normalized: string): string | undefined {
  const labeled = inferValue(lines, "公司");
  if (labeled) return labeled;

  const textMatch = normalized.match(/([^\s，。,；;：:]{2,24}(?:科技|网络|信息|软件|智能|数科|技术|集团|公司))/);
  return sanitizeLabeledValue(textMatch?.[1]);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildEvidence(lines: string[], keywords: string[], metrics: string[]): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];
  let currentTitle = "";

  lines.forEach((line) => {
    const isTitle = !line.startsWith("-") && !/^\d+[.、]/.test(line) && line.length <= 30;
    if (isTitle && /(项目|实习|经历|教育|技能|评价|背景)/.test(line)) {
      currentTitle = line;
      return;
    }

    if (line.startsWith("-") || line.includes("负责") || line.includes("协助") || /\d/.test(line)) {
      const localKeywords = keywords.filter((keyword) => line.toLowerCase().includes(keyword.toLowerCase())).slice(0, 5);
      const localMetrics = metrics.filter((metric) => line.includes(metric));
      evidence.push({
        id: `ev-${evidence.length + 1}`,
        type: inferEvidenceType(currentTitle, line),
        title: currentTitle || inferEvidenceTitle(line),
        detail: line.replace(/^-\s*/, ""),
        keywords: localKeywords,
        impact: localMetrics.length > 0 ? `包含可量化结果：${localMetrics.join("、")}` : "可作为岗位相关经历，但建议补充量化结果",
      });
    }
  });

  return evidence.slice(0, 12);
}

function inferEvidenceType(title: string, detail: string): EvidenceItem["type"] {
  if (title.includes("教育")) return "教育";
  if (title.includes("实习")) return "实习";
  if (title.includes("技能") || detail.includes("SQL") || detail.includes("Excel")) return "技能";
  if (/\d/.test(detail)) return "成果";
  return "项目";
}

function inferEvidenceTitle(line: string): string {
  if (line.includes("社群")) return "社群运营经历";
  if (line.includes("数据")) return "数据分析经历";
  if (line.includes("用户")) return "用户研究经历";
  return "项目经历";
}

function buildResumeRisks(text: string, evidence: EvidenceItem[], metrics: string[]): string[] {
  const risks: string[] = [];
  if (metrics.length < 2) risks.push("量化结果偏少，面试中容易被追问贡献和效果。");
  if (!text.includes("SQL") && !text.includes("数据")) risks.push("数据分析证据不足，需补一段工具或分析案例。");
  if (evidence.length < 4) risks.push("可用于回答的经历素材偏少，建议补充项目背景和个人动作。");
  if (!text.includes("复盘")) risks.push("复盘意识表达不足，运营类岗位可能继续追问。");
  return risks;
}

function buildHiddenSignals(text: string, hardSkills: string[], softSkills: string[]): string[] {
  const signals = ["指标意识", "用户理解", "快速迭代", "复盘能力"];
  if (text.includes("校招")) signals.push("校招场景理解");
  if (text.includes("社群")) signals.push("社群转化");
  if (hardSkills.length > 0) signals.push("工具化执行");
  if (softSkills.length > 0) signals.push("跨团队沟通");
  return unique(signals).slice(0, 8);
}

function buildGaps(resume: ResumeAnalysis, job: JobAnalysis, resumeKeywords: string[]): MatchReport["gaps"] {
  const gaps: MatchReport["gaps"] = [];
  job.hardSkills.forEach((skill) => {
    const matched = resumeKeywords.some((keyword) => keyword.toLowerCase() === skill.toLowerCase());
    gaps.push({
      label: skill,
      type: matched ? "match" : "gap",
      description: matched ? "简历已有相关证据，面试中要讲清动作和结果。" : "JD 明确要求，但简历证据较弱，建议补充学习或项目案例。",
    });
  });
  resume.risks.slice(0, 3).forEach((risk) => {
    gaps.push({ label: "表达风险", type: "risk", description: risk });
  });
  if (gaps.length === 0) {
    gaps.push({ label: "岗位相关性", type: "match", description: "简历和 JD 有基础重合，建议继续强化成果表达。" });
  }
  return gaps.slice(0, 10);
}

function buildRewriteSuggestions(resume: ResumeAnalysis, job: JobAnalysis, resumeText: string): RewriteSuggestion[] {
  const lines = splitLines(resumeText).filter((line) => line.startsWith("-") || line.includes("负责") || line.includes("协助"));
  const suggestions: RewriteSuggestion[] = lines.slice(0, 5).map((line) => {
    const relatedSkill = job.hardSkills.find((skill) => line.toLowerCase().includes(skill.toLowerCase())) ?? job.hardSkills[0] ?? "岗位核心能力";
    const metric = findMetrics(line)[0] ?? resume.metrics[0] ?? "明确指标";
    return {
      before: line.replace(/^-\s*/, ""),
      after: `${line.replace(/^-\s*/, "")}，突出${relatedSkill}能力，并补充${metric}对应的业务结果。`,
      reason: "把动作、岗位关键词和结果放在同一句里，更利于 ATS 和面试官快速识别。",
    };
  });

  if (suggestions.length === 0) {
    suggestions.push({
      before: "简历经历描述较少",
      after: `补充一段与${job.title}相关的项目，按“目标、动作、结果、复盘”四段写清。`,
      reason: "没有经历证据时，后续问题和答案会变得泛化。",
    });
  }
  return suggestions;
}

function fallbackEvidence(resume: ResumeAnalysis): EvidenceItem[] {
  return [
    {
      id: "ev-fallback",
      type: "练习推断",
      title: `${resume.targetRole}（待补真实证据）`,
      detail: `当前仅基于已有简历摘要推断相关经历方向：${resume.summary}`,
      keywords: resume.skills.slice(0, 4),
      impact: "练习模式推断，需补充真实项目、动作和可验证结果",
      synthetic: true,
    },
  ];
}

function findEvidenceForKeyword(evidence: EvidenceItem[], keyword: string): EvidenceItem {
  return (
    evidence.find((item) => item.keywords.some((itemKeyword) => itemKeyword.toLowerCase() === keyword.toLowerCase())) ??
    evidence.find((item) => sentenceIncludesAny(item.detail, [keyword])) ??
    evidence[0]
  );
}

export function prioritizeEvidenceForJob(resume: ResumeAnalysis, job: JobAnalysis, evidence: EvidenceItem[]): EvidenceItem[] {
  const jobSignals = unique([...job.hardSkills, ...job.softSkills, ...job.keywords.slice(0, 8)]);
  const jobText = `${job.title} ${job.hardSkills.join(" ")} ${job.keywords.join(" ")}`.toLowerCase();
  const isEngineeringRole = /前端|开发|工程|react|vue|typescript|javascript|html|css|node/.test(jobText);
  const engineeringSignals = ["前端", "开发", "React", "Vue", "TypeScript", "JavaScript", "HTML", "CSS", "Node", "工程", "小程序", "系统", "页面", "组件", "接口"];
  const operationSignals = ["运营", "社群", "活动", "增长", "转化", "直播", "课程", "用户增长"];
  const scored = evidence
    .map((item) => {
      const haystack = `${item.title} ${item.detail} ${item.keywords.join(" ")} ${item.impact}`.toLowerCase();
      const keywordScore = jobSignals.reduce((sum, signal) => sum + (haystack.includes(signal.toLowerCase()) ? 4 : 0), 0);
      const engineeringScore = isEngineeringRole ? engineeringSignals.reduce((sum, signal) => sum + (haystack.includes(signal.toLowerCase()) ? 7 : 0), 0) : 0;
      const operationPenalty = isEngineeringRole ? operationSignals.reduce((sum, signal) => sum + (haystack.includes(signal.toLowerCase()) ? 5 : 0), 0) : 0;
      const metricScore = /\d/.test(item.impact) ? 6 : 0;
      const typeScore = item.type === "项目" || item.type === "实习" ? 5 : item.type === "成果" ? 4 : item.type === "技能" ? 6 : 1;
      const titleScore = item.title.toLowerCase().includes(job.title.toLowerCase()) ? 8 : 0;
      const recencyScore = resume.evidence[0]?.id === item.id ? 2 : 0;
      const educationPenalty = isEngineeringRole && item.type === "教育" ? 8 : 0;
      return { item, score: keywordScore + engineeringScore + metricScore + typeScore + titleScore + recencyScore - operationPenalty - educationPenalty };
    })
    .sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}

function resolveEvidence(ids: string[], evidence: EvidenceItem[]): EvidenceItem[] {
  const resolved = ids.map((id) => evidence.find((item) => item.id === id)).filter(Boolean) as EvidenceItem[];
  return resolved.length > 0 ? resolved : evidence.slice(0, 1);
}

// ---- Candidate profile + multi-position model -----------------------------

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULT_INTERVIEW_PREFERENCES: InterviewPreferences = {
  interviewerRole: "上级",
  difficulty: "压力面",
  interviewerGender: "女",
  submitMode: "manual",
  style: "gentle",
};

const INTAKE_FIELD_DEFINITIONS: PositionIntakeFieldDefinition[] = [
  { key: "company", label: "目标公司" },
  { key: "role", label: "岗位名称" },
  { key: "interviewer", label: "面试官类型" },
  { key: "difficulty", label: "面试难度" },
  { key: "duration", label: "面试时长" },
  { key: "hasJd", label: "完整 JD" },
];

function inferInterviewerType(text: string): string {
  if (/HR/i.test(text)) return "HR";
  if (/CTO/i.test(text)) return "CTO";
  if (/CEO/i.test(text)) return "CEO";
  if (text.includes("业务")) return "业务负责人";
  return "上级";
}

function inferInterviewDifficulty(text: string): string {
  if (text.includes("地狱")) return "地狱面";
  if (text.includes("压力")) return "压力面";
  return "正常";
}

function inferDuration(text: string): string {
  const matched = text.match(/(\d+\s*(分钟|min))/i)?.[0];
  return matched?.replace(/\s+/g, "") ?? "";
}

function inferHasJd(text: string): string {
  return text.trim().length >= 80 || text.includes("岗位职责") || text.includes("任职要求") ? "已有完整 JD" : "待补充完整 JD";
}

function createFieldValue(
  definition: PositionIntakeFieldDefinition,
  value: string,
  source: PositionIntakeFieldSource,
): PositionIntakeFieldValue {
  return {
    key: definition.key,
    label: definition.label,
    value: value.trim(),
    source,
  };
}

function uniqueFieldValues(items: PositionIntakeFieldValue[]): PositionIntakeFieldValue[] {
  const latest = new Map<PositionIntakeFieldKey, PositionIntakeFieldValue>();
  items.forEach((item) => latest.set(item.key, item));
  return INTAKE_FIELD_DEFINITIONS.map((definition) => latest.get(definition.key)).filter(Boolean) as PositionIntakeFieldValue[];
}

function normalizeLegacyIntakeField(key: string): PositionIntakeFieldKey | null {
  if (key === "goal" || key === "role") return "role";
  if (key === "interviewer") return "interviewer";
  if (key === "difficulty") return "difficulty";
  if (key === "duration") return "duration";
  if (key === "hasJd") return "hasJd";
  return null;
}

function buildInferredIntakeFields(job: JobAnalysis, rawJdText: string): PositionIntakeFieldValue[] {
  const inferredMap = new Map<PositionIntakeFieldKey, string>([
    ["company", job.company || "目标公司"],
    ["role", job.title || "目标岗位"],
    ["interviewer", inferInterviewerType(rawJdText)],
    ["difficulty", inferInterviewDifficulty(rawJdText)],
    ["duration", inferDuration(rawJdText)],
    ["hasJd", inferHasJd(rawJdText)],
  ]);

  return INTAKE_FIELD_DEFINITIONS.map((definition) =>
    createFieldValue(definition, inferredMap.get(definition.key) ?? "", "inferred"),
  );
}

function createIntakeState(job: JobAnalysis, jobText: string, previous?: Partial<PositionIntakeState>): PositionIntakeState {
  const timestamp = nowIso();
  const rawJdText = previous?.rawJdText?.trim() ? previous.rawJdText : jobText;
  const inferredFields = buildInferredIntakeFields(job, rawJdText);
  const legacyFields = (previous as { fields?: Array<{ key: string; label?: string; value: string; confirmed?: boolean }> } | undefined)?.fields ?? [];
  const confirmedFromPrevious =
    previous?.confirmedFields?.length
      ? previous.confirmedFields
      : legacyFields
          .filter((field) => field.confirmed)
          .map((field) => {
            const normalizedKey = normalizeLegacyIntakeField(field.key);
            if (!normalizedKey) return null;
            const definition = INTAKE_FIELD_DEFINITIONS.find((item) => item.key === normalizedKey)!;
            return createFieldValue(definition, field.value, "confirmed");
          })
          .filter((item): item is PositionIntakeFieldValue => Boolean(item));

  const confirmedFields = uniqueFieldValues(
    confirmedFromPrevious.map((field) => ({
      ...field,
      label: INTAKE_FIELD_DEFINITIONS.find((item) => item.key === field.key)?.label ?? field.label,
      source: "confirmed" as const,
    })),
  );

  const fieldSources = INTAKE_FIELD_DEFINITIONS.reduce<Record<PositionIntakeFieldKey, PositionIntakeFieldSource>>((acc, definition) => {
    acc[definition.key] = confirmedFields.some((field) => field.key === definition.key) ? "confirmed" : "inferred";
    return acc;
  }, {} as Record<PositionIntakeFieldKey, PositionIntakeFieldSource>);

  const missingFields = INTAKE_FIELD_DEFINITIONS.filter((definition) => {
    const confirmedValue = confirmedFields.find((field) => field.key === definition.key)?.value.trim();
    if (confirmedValue) return false;
    if (definition.key === "duration") return false;
    const inferredValue = inferredFields.find((field) => field.key === definition.key)?.value.trim();
    if (!inferredValue) return true;
    if (definition.key === "company") return inferredValue === "目标公司";
    if (definition.key === "role") return inferredValue === "目标岗位";
    return false;
  });

  const reviewStatus: PositionIntakeState["reviewStatus"] =
    !rawJdText.trim()
      ? "empty"
      : missingFields.length === 0
        ? "confirmed"
        : confirmedFields.length > 0
          ? "review"
          : "draft";

  return {
    messages:
      previous?.messages?.length
        ? previous.messages
        : [
            {
              id: makeId("intake-assistant"),
              role: "assistant",
              text: "把真实 JD 或岗位信息贴给我，我会保留你的原文，并标出系统推断和缺失字段供你确认。",
              createdAt: timestamp,
            },
          ],
    rawJdText,
    inferredFields,
    confirmedFields,
    missingFields,
    fieldSources,
    reviewStatus,
    suggestedPrompts: previous?.suggestedPrompts?.length
      ? previous.suggestedPrompts
      : ["这是字节跳动 AI 产品经理 JD，请先保留原文并告诉我缺什么字段", "这是 HR 约的业务负责人面，帮我补全当前岗位信息", "我先贴真实 JD，再确认系统推断的岗位和难度"],
    configuredInterview: previous?.configuredInterview ?? false,
  };
}

function applyConfirmedPositionFields(job: JobAnalysis, intake: PositionIntakeState): JobAnalysis {
  const confirmedCompany = intake.confirmedFields.find((field) => field.key === "company")?.value.trim();
  const confirmedRole = intake.confirmedFields.find((field) => field.key === "role")?.value.trim();
  return {
    ...job,
    company: confirmedCompany || job.company,
    title: confirmedRole || job.title,
  };
}

export function createAnalysisContext(
  profile: CandidateProfile,
  job: JobAnalysis,
  matchReport: MatchReport,
  questions: InterviewQuestion[],
  materials: PositionMaterial[] = [],
): PositionAnalysisContext {
  return {
    priorityFocus: [
      ...job.hardSkills.slice(0, 3).map((item) => `补强 ${item} 的项目证据`),
      ...matchReport.gaps.filter((gap) => gap.type !== "match").slice(0, 2).map((gap) => gap.description),
    ].slice(0, 5),
    likelyQuestions: questions.filter((question) => question.priority).slice(0, 6).map((question) => question.question),
    preparationTips: [
      `回答时优先贴合 ${job.title || "当前岗位"} 的职责和关键词。`,
      "每个高频问题至少准备一段可量化项目证据。",
      "把上传资料里的项目细节同步到模拟面试和实时助手上下文。",
    ],
    evidenceHighlights: profile.evidenceLibrary.slice(0, 4).map((item) => `${item.title}：${item.impact}`),
    materialHighlights: materials.slice(0, 4).map((item) => `${item.title}：${item.summary || item.detail.slice(0, 80)}`),
    updatedAt: nowIso(),
  };
}

export function createProfile(resumeText: string): CandidateProfile {
  const resume = analyzeResume(resumeText);
  return {
    displayName: resume.name,
    resumeText,
    resume,
    evidenceLibrary: resume.evidence,
    highlights: [],
  };
}

// Re-analyze the resume while keeping any user-curated highlights.
export function recomputeProfile(resumeText: string, previous?: CandidateProfile): CandidateProfile {
  const next = createProfile(resumeText);
  if (!previous) return next;
  const curated = previous.evidenceLibrary.filter((item) => item.id.startsWith("ev-custom-"));
  const merged = mergeEvidence(next.evidenceLibrary, curated);
  return { ...next, evidenceLibrary: merged, highlights: previous.highlights };
}

export function normalizePosition(position: Position, profile: CandidateProfile): Position {
  const analyzedJob = position.job ?? analyzeJob(position.jobText);
  const intake = createIntakeState(analyzedJob, position.jobText, position.intake);
  const job = applyConfirmedPositionFields(analyzedJob, intake);
  const questions = Array.isArray(position.questions) ? position.questions : generateQuestions(withEvidenceLibrary(profile), job, 28);
  const matchReport = position.matchReport ?? createMatchReport(profile.resume, job, profile.resumeText);
  const materials = Array.isArray(position.materials) ? position.materials : [];
  return {
    ...position,
    title: job.title,
    company: job.company,
    job,
    intake,
    materials,
    interviewPreferences: { ...DEFAULT_INTERVIEW_PREFERENCES, ...(position.interviewPreferences ?? {}) },
    analysisContext: position.analysisContext ?? createAnalysisContext(profile, job, matchReport, questions, materials),
  };
}

export function createPosition(jobText: string, profile: CandidateProfile, init?: Partial<Position>): Position {
  const analyzedJob = analyzeJob(jobText);
  const intake = createIntakeState(analyzedJob, jobText, init?.intake);
  const job = applyConfirmedPositionFields(analyzedJob, intake);
  const matchReport = createMatchReport(profile.resume, job, profile.resumeText);
  const resumeWithLibrary = withEvidenceLibrary(profile);
  const questions = generateQuestions(resumeWithLibrary, job, 28);
  const answers = generateAnswerDrafts(questions, resumeWithLibrary, job, profile.evidenceLibrary);
  const mockTurns = (init?.mockTurns ?? []).filter((turn) => questions.some((question) => question.id === turn.questionId));
  const report = buildInterviewReport(mockTurns, questions, matchReport);
  const timestamp = nowIso();
  const materials = init?.materials ?? [];
  return {
    id: init?.id ?? makeId("pos"),
    title: job.title,
    company: job.company,
    jobText,
    job,
    matchReport,
    questions,
    answers,
    mockTurns,
    report,
    selectedQuestionId: questions[0]?.id ?? "",
    intake,
    materials,
    interviewPreferences: { ...DEFAULT_INTERVIEW_PREFERENCES, ...(init?.interviewPreferences ?? {}) },
    analysisContext: createAnalysisContext(profile, job, matchReport, questions, materials),
    status: init?.status ?? "planning",
    notes: init?.notes ?? "",
    createdAt: init?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

// Recompute one position against (possibly updated) JD or profile, keeping
// status/notes/timeline and any still-valid mock turns.
export function recomputePosition(position: Position, profile: CandidateProfile): Position {
  const analyzedJob = analyzeJob(position.jobText);
  const intake = createIntakeState(analyzedJob, position.jobText, position.intake);
  const job = applyConfirmedPositionFields(analyzedJob, intake);
  const matchReport = createMatchReport(profile.resume, job, profile.resumeText);
  const resumeWithLibrary = withEvidenceLibrary(profile);

  // Preserve user-added questions (manual, cueCard, material, mock sources)
  const userQuestions = position.questions.filter((q) => q.source !== "diagnosis");
  const autoQuestions = generateQuestions(resumeWithLibrary, job, 28);

  // Merge: user questions first, then auto questions that don't duplicate
  const userQuestionTexts = new Set(userQuestions.map((q) => q.question.trim()));
  const dedupedAuto = autoQuestions.filter((q) => !userQuestionTexts.has(q.question.trim()));
  const questions = [...userQuestions, ...dedupedAuto];

  const answers = generateAnswerDrafts(questions, resumeWithLibrary, job, profile.evidenceLibrary);
  const mockTurns = position.mockTurns.filter((turn) => questions.some((question) => question.id === turn.questionId));
  const report = buildInterviewReport(mockTurns, questions, matchReport);
  const materials = position.materials ?? [];
  return {
    ...position,
    title: job.title,
    company: job.company,
    job,
    matchReport,
    questions,
    answers,
    mockTurns,
    report,
    selectedQuestionId: questions.some((question) => question.id === position.selectedQuestionId)
      ? position.selectedQuestionId
      : questions[0]?.id ?? "",
    intake,
    materials,
    interviewPreferences: { ...DEFAULT_INTERVIEW_PREFERENCES, ...(position.interviewPreferences ?? {}) },
    analysisContext: createAnalysisContext(profile, job, matchReport, questions, materials),
    updatedAt: nowIso(),
  };
}

export function createInitialAppState(): AppState {
  const profile = createProfile("");
  return { profile, positions: [], activePositionId: "", interviewRecords: [], activeRecordId: "", aiMode: false, journeyState: "guest" };
}

// Flatten the active position into the legacy WorkspaceState the per-position
// screens consume.
export function toWorkspace(profile: CandidateProfile, position: Position): WorkspaceState {
  const resumeWithLibrary = withEvidenceLibrary(profile);
  return {
    resumeText: profile.resumeText,
    jobText: position.jobText,
    resume: resumeWithLibrary,
    job: position.job,
    matchReport: position.matchReport,
    questions: position.questions,
    answers: position.answers,
    mockTurns: position.mockTurns,
    report: position.report,
    selectedQuestionId: position.selectedQuestionId,
  };
}

function mergeEvidence(base: EvidenceItem[], extra: EvidenceItem[]): EvidenceItem[] {
  const seen = new Set<string>();
  return [...base, ...extra].filter((item) => {
    const key = `${item.title}|${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withEvidenceLibrary(profile: CandidateProfile): ResumeAnalysis {
  return {
    ...profile.resume,
    evidence: mergeEvidence(profile.evidenceLibrary, profile.resume.evidence),
  };
}

/** 倒排索引：keyword → evidence indices，避免 O(n*m) 字符串遍历 */
let _invertedIndex: Map<string, number[]> | null = null;
let _indexedIds = "";

function buildInvertedIndex(evidence: EvidenceItem[]): Map<string, number[]> {
  const inverted = new Map<string, number[]>();
  evidence.forEach((item, i) => {
    const tokens = unique(extractKeywords(`${item.title} ${item.detail} ${item.keywords.join(" ")}`, 50));
    for (const token of tokens) {
      const key = token.toLowerCase();
      const list = inverted.get(key);
      if (list) list.push(i);
      else inverted.set(key, [i]);
    }
  });
  return inverted;
}

function getOrBuildInvertedIndex(evidence: EvidenceItem[]): Map<string, number[]> {
  const idKey = evidence.map((e) => e.id).join("|");
  if (!_invertedIndex || _indexedIds !== idKey) {
    _invertedIndex = buildInvertedIndex(evidence);
    _indexedIds = idKey;
  }
  return _invertedIndex;
}

/** 基于倒排索引的 evidence 匹配，O(signal) 级查找 */
function pickEvidenceForQuestionFast(question: string, evidence: EvidenceItem[], jobKeywords: string[]): EvidenceItem[] {
  const signals = unique([...extractKeywords(question, 12), ...jobKeywords.slice(0, 8)]).map((s) => s.toLowerCase());
  const inverted = getOrBuildInvertedIndex(evidence);
  const scores = new Map<number, number>();
  for (const signal of signals) {
    const indices = inverted.get(signal);
    if (indices) {
      for (const i of indices) {
        scores.set(i, (scores.get(i) ?? 0) + 1);
      }
    }
  }
  const sorted = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  const matched = sorted.map(([i]) => evidence[i]);
  return (matched.length > 0 ? matched : evidence).slice(0, 3);
}
