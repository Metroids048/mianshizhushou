import type { AppState, InterviewRecord, InterviewQuestion, Position } from "../types";

export const DATA_REPAIR_NEEDED = "需重新补充";

const REPLACEMENTS: Array<[string, string]> = [
  ["涓婁笂鏂囪祫鏂?", "上下文资料"],
  ["涓婁笅鏂囪祫鏂?", "上下文资料"],
  ["宀椾綅鍙?", "岗位台"],
  ["瀹炴椂鍔╂墜", "实时助手"],
  ["妯℃嫙闈㈣瘯", "模拟面试"],
  ["璁板綍澶嶇洏", "记录复盘"],
  ["鍊欓€変汉", "候选人"],
  ["鍩虹", "基础"],
  ["杩涢樁", "进阶"],
  ["鍘嬪姏", "压力"],
  ["琛屼负闈?", "行为面"],
  ["椤圭洰娣辨寲", "项目深挖"],
  ["涓撲笟鎶€鑳?", "专业技能"],
  ["宀椾綅鍔ㄦ満", "岗位动机"],
  ["鍘嬪姏棰?", "压力题"],
  ["鑻辨枃棰?", "英文题"],
  ["鏁欒偛", "教育"],
  ["瀹炰範", "实习"],
  ["椤圭洰", "项目"],
  ["鎶€鑳?", "技能"],
  ["鎴愭灉", "成果"],
  ["鏈湴缁冧範", "本地练习"],
  ["鍚庣鏈繛鎺?", "后端未连接"],
  ["鍚庣鏈繑鍥?", "后端未返回"],
  ["妯″瀷鐢熸垚", "模型生成"],
  ["绛夊緟闂", "等待问题"],
  ["棰樿瘝鍗?", "提词卡"],
  ["鐢熸垚棰樿瘝鍗?", "生成提词卡"],
  ["鍙兘杩介棶", "可能追问"],
  ["椋庨櫓鎻愰啋", "风险提醒"],
  ["鍥炵瓟绛栫暐", "回答策略"],
  ["瑕佺偣", "要点"],
  ["纭 JD", "确认 JD"],
  ["鍘绘ā鎷熺粌涔?", "去模拟练习"],
  ["鍚彇", "听取"],
  ["鍋滄鍚彇", "停止听取"],
  ["閲嶅綍", "重录"],
  ["鍙紪杈?", "可编辑"],
  ["鎵嬪姩纭", "手动确认"],
  ["鑷姩鐢熸垚", "自动生成"],
  ["绛夊緟鐢熸垚", "等待生成"],
  ["绛夊緟璇煶鎴栨枃鏈緭鍏ャ€?", "正在等待语音或文本输入。"],
  ["鍙紪杈戞枃鏈?", "可编辑文本"],
  ["瀹炴椂闂杈撳叆", "实时问题输入"],
  ["淇濆瓨璁板綍", "保存记录"],
  ["缁勭粐琛ㄨ揪", "组织表达"],
  ["淇濆瓨 JD", "保存 JD"],
  ["鍙栨秷", "取消"],
  ["鍏抽棴", "关闭"],
  ["妯″瀷闈㈣瘯瀹?", "模型面试官"],
  ["鏈湴杩介棶", "本地追问"],
  ["杩炴帴涓?", "连接中"],
  ["鎴戣瀹屼簡", "我说完了"],
  ["鏆傚仠", "暂停"],
  ["缁撴潫", "结束"],
  ["楹﹀厠椋?", "麦克风"],
  ["鏈楄", "朗读"],
  ["璺宠繃", "跳过"],
  ["作答区", "作答区"],
];

const MOJIBAKE_PATTERN = /(涓|妯|棰|瀹|鎶|鍊|绛|闈|杩|鍙|鑱|銆|锛|�)/;

export function hasCorruptedText(value: string | undefined | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /\?{2,}/.test(trimmed) || MOJIBAKE_PATTERN.test(trimmed);
}

export function sanitizeDisplayText(value: string | undefined | null, fallback = DATA_REPAIR_NEEDED): string {
  const repaired = repairText(value);
  return hasCorruptedText(repaired) ? fallback : repaired;
}

export function repairText(value: string | undefined | null): string {
  if (!value) return "";
  let next = value;
  for (const [from, to] of REPLACEMENTS) {
    next = next.split(from).join(to);
  }
  return next
    .split("銆?").join("。")
    .split("锛歖").join("：")
    .split("锛?").join("？")
    .replace(/\bMVP\b(?!（最小可行产品）)/g, "MVP（最小可行产品）")
    .split("路").join("·")
    .trim();
}

function repairQuestion(question: InterviewQuestion): InterviewQuestion {
  return {
    ...question,
    category: repairText(question.category),
    question: repairText(question.question),
    reason: repairText(question.reason),
    difficulty: repairText(question.difficulty),
    notes: repairText(question.notes),
    answer: repairText(question.answer),
    tags: question.tags?.map(repairText),
  };
}

function repairRecord(record: InterviewRecord): InterviewRecord {
  return {
    ...record,
    title: repairText(record.title),
    summary: repairText(record.summary),
    transcript: record.transcript.map((item) => ({ ...item, text: repairText(item.text) })),
    questionResults: record.questionResults?.map((item) => ({
      ...item,
      questionText: repairText(item.questionText),
      answer: repairText(item.answer),
      feedback: repairText(item.feedback),
      followUp: repairText(item.followUp),
    })),
    cueCards: record.cueCards.map((card) => ({
      ...card,
      questionText: repairText(card.questionText),
      strategy: repairText(card.strategy),
      openingLine: repairText(card.openingLine),
      bullets: card.bullets.map(repairText),
      risks: card.risks.map(repairText),
      followUps: card.followUps.map(repairText),
    })),
    report: {
      ...record.report,
      summary: repairText(record.report.summary),
      nextActions: record.report.nextActions.map(repairText),
      structuredDimensions: record.report.structuredDimensions?.map((item) => ({
        ...item,
        name: repairText(item.name),
        comment: repairText(item.comment),
      })),
      strengthPoints: record.report.strengthPoints?.map(repairText),
      improvementPoints: record.report.improvementPoints?.map(repairText),
      suggestedNextPractice: repairText(record.report.suggestedNextPractice),
    },
    conversationHistory: record.conversationHistory?.map((item) => ({ ...item, text: repairText(item.text) })),
    aiMeta: record.aiMeta
      ? {
          ...record.aiMeta,
          fallbackReason: repairText(record.aiMeta.fallbackReason),
          model: repairText(record.aiMeta.model),
          internalNote: repairText(record.aiMeta.internalNote),
        }
      : undefined,
  };
}

function repairPosition(position: Position): Position {
  return {
    ...position,
    title: repairText(position.title),
    company: repairText(position.company),
    notes: repairText(position.notes),
    job: {
      ...position.job,
      title: repairText(position.job.title),
      company: repairText(position.job.company),
      responsibilities: position.job.responsibilities.map(repairText),
      hardSkills: position.job.hardSkills.map(repairText),
      softSkills: position.job.softSkills.map(repairText),
      hiddenSignals: position.job.hiddenSignals.map(repairText),
      keywords: position.job.keywords.map(repairText),
    },
    matchReport: {
      ...position.matchReport,
      summary: repairText(position.matchReport.summary),
      gaps: position.matchReport.gaps.map((item) => ({
        ...item,
        label: repairText(item.label),
        type: repairText(item.type) as typeof item.type,
        description: repairText(item.description),
      })),
      rewriteSuggestions: position.matchReport.rewriteSuggestions.map((item) => ({
        ...item,
        before: repairText(item.before),
        after: repairText(item.after),
        reason: repairText(item.reason),
      })),
    },
    questions: position.questions.map(repairQuestion),
    answers: position.answers.map((item) => ({
      ...item,
      speakable: repairText(item.speakable),
      concise: repairText(item.concise),
      followUp: repairText(item.followUp),
      caution: repairText(item.caution),
    })),
    mockTurns: position.mockTurns.map((item) => ({
      ...item,
      answer: repairText(item.answer),
      feedback: repairText(item.feedback),
      transcript: item.transcript?.map((turn) => ({ ...turn, text: repairText(turn.text) })),
      speechMetrics: item.speechMetrics ? { ...item.speechMetrics, comment: repairText(item.speechMetrics.comment), fillers: item.speechMetrics.fillers.map(repairText) } : undefined,
    })),
    report: {
      ...position.report,
      summary: repairText(position.report.summary),
      nextActions: position.report.nextActions.map(repairText),
      structuredDimensions: position.report.structuredDimensions?.map((item) => ({
        ...item,
        name: repairText(item.name),
        comment: repairText(item.comment),
      })),
      strengthPoints: position.report.strengthPoints?.map(repairText),
      improvementPoints: position.report.improvementPoints?.map(repairText),
      suggestedNextPractice: repairText(position.report.suggestedNextPractice),
    },
    intake: position.intake
      ? {
          ...position.intake,
          messages: position.intake.messages.map((item) => ({ ...item, text: repairText(item.text) })),
          rawJdText: repairText(position.intake.rawJdText),
          inferredFields: position.intake.inferredFields.map((item) => ({ ...item, label: repairText(item.label), value: repairText(item.value) })),
          confirmedFields: position.intake.confirmedFields.map((item) => ({ ...item, label: repairText(item.label), value: repairText(item.value) })),
          missingFields: position.intake.missingFields.map((item) => ({ ...item, label: repairText(item.label) })),
          suggestedPrompts: position.intake.suggestedPrompts.map(repairText),
        }
      : position.intake,
    materials: position.materials?.map((item) => ({
      ...item,
      title: repairText(item.title),
      detail: repairText(item.detail),
      summary: repairText(item.summary),
      keywords: item.keywords.map(repairText),
      tags: item.tags.map(repairText),
    })),
    analysisContext: position.analysisContext
      ? {
          ...position.analysisContext,
          priorityFocus: position.analysisContext.priorityFocus.map(repairText),
          likelyQuestions: position.analysisContext.likelyQuestions.map(repairText),
          preparationTips: position.analysisContext.preparationTips.map(repairText),
          evidenceHighlights: position.analysisContext.evidenceHighlights.map(repairText),
          materialHighlights: position.analysisContext.materialHighlights.map(repairText),
        }
      : position.analysisContext,
  };
}

export function repairAppState(state: AppState): AppState {
  return {
    ...state,
    profile: {
      ...state.profile,
      displayName: repairText(state.profile.displayName),
      resumeText: repairText(state.profile.resumeText),
      highlights: state.profile.highlights.map(repairText),
      resume: {
        ...state.profile.resume,
        name: repairText(state.profile.resume.name),
        targetRole: repairText(state.profile.resume.targetRole),
        summary: repairText(state.profile.resume.summary),
        evidence: state.profile.resume.evidence.map((item) => ({
          ...item,
          type: repairText(item.type),
          title: repairText(item.title),
          detail: repairText(item.detail),
          keywords: item.keywords.map(repairText),
          impact: repairText(item.impact),
        })),
        skills: state.profile.resume.skills.map(repairText),
        metrics: state.profile.resume.metrics.map(repairText),
        risks: state.profile.resume.risks.map(repairText),
      },
      evidenceLibrary: state.profile.evidenceLibrary.map((item) => ({
        ...item,
        type: repairText(item.type),
        title: repairText(item.title),
        detail: repairText(item.detail),
        keywords: item.keywords.map(repairText),
        impact: repairText(item.impact),
      })),
    },
    positions: state.positions.map(repairPosition),
    interviewRecords: state.interviewRecords.map(repairRecord),
  };
}
