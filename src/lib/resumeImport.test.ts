import { describe, expect, it } from "vitest";
import { importResumeFile } from "./resumeImport";

describe("resumeImport", () => {
  it("imports txt resume content", async () => {
    const file = new File(["张晨\n项目经历\n- 负责增长运营"], "resume.txt", { type: "text/plain" });
    const result = await importResumeFile(file);

    expect(result.kind).toBe("text");
    expect(result.text).toContain("增长运营");
  });

  it("rejects unsupported file types", async () => {
    const file = new File(["{}"], "resume.json", { type: "application/json" });

    await expect(importResumeFile(file)).rejects.toThrow("UNSUPPORTED_RESUME_FILE");
  });
});
