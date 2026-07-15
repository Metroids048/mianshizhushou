import { SpeechMetrics } from "../types";

const FILLER_WORDS = ["嗯", "啊", "呃", "那个", "然后就", "就是说", "um", "uh", "like"];

// Analyzes a spoken answer's transcript + measured speaking duration into pace
// and filler-word feedback. Pure and deterministic.
export function analyzeSpeech(text: string, durationSec: number): SpeechMetrics {
  const charCount = text.replace(/\s/g, "").length;
  const fillers: string[] = [];
  let fillerCount = 0;
  FILLER_WORDS.forEach((word) => {
    const matches = text.match(new RegExp(word, "g"));
    if (matches && matches.length > 0) {
      fillerCount += matches.length;
      fillers.push(`${word}×${matches.length}`);
    }
  });
  const charsPerMinute = durationSec > 0 ? Math.round((charCount / durationSec) * 60) : 0;

  return {
    charCount,
    durationSec: Math.round(durationSec),
    charsPerMinute,
    fillerCount,
    fillers,
    comment: buildComment(charsPerMinute, fillerCount, durationSec),
  };
}

function buildComment(charsPerMinute: number, fillerCount: number, durationSec: number): string {
  const parts: string[] = [];
  if (durationSec <= 0) {
    parts.push("用「语音作答」口述可获得语速与口头禅分析。");
  } else if (charsPerMinute > 320) {
    parts.push("语速偏快，注意停顿让表达更清晰。");
  } else if (charsPerMinute > 0 && charsPerMinute < 150) {
    parts.push("语速偏慢，可适当加快并精简。");
  } else {
    parts.push("语速适中。");
  }

  if (fillerCount >= 4) {
    parts.push(`口头禅偏多（${fillerCount} 次），减少“嗯/那个”等填充词。`);
  } else if (fillerCount > 0) {
    parts.push(`有少量口头禅（${fillerCount} 次）。`);
  }
  return parts.join(" ");
}
