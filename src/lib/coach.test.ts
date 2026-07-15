import { describe, expect, it } from "vitest";
import { createProfile } from "./interviewEngine";
import { generateHighlightsLocal } from "./coach";
import { sampleResume } from "../data/sampleInputs";

describe("coach (local fallbacks)", () => {
  it("generates resume highlights", () => {
    const highlights = generateHighlightsLocal(createProfile(sampleResume));
    expect(highlights.length).toBeGreaterThan(0);
  });
});
