import { CandidateProfile } from "../types";

export function generateHighlightsLocal(profile: CandidateProfile): string[] {
  const highlights: string[] = [];
  profile.resume.evidence.slice(0, 4).forEach((item) => {
    if (item.impact.includes("可量化")) {
      highlights.push(`${item.title}：${item.detail}`);
    }
  });
  const metrics = profile.resume.metrics.slice(0, 3);
  if (metrics.length > 0) highlights.push(`关键量化成果：${metrics.join("、")}`);
  if (profile.resume.skills.length > 0) highlights.push(`核心技能组合：${profile.resume.skills.slice(0, 5).join("、")}`);
  return highlights.filter((item, index, arr) => arr.indexOf(item) === index).slice(0, 5);
}
