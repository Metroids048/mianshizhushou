/// <reference types="node" />
// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importResumeFile } from "./resumeImport";

describe("resumeImport node samples", () => {
  it("imports the real pdf resume sample in node fallback mode", async () => {
    const bytes = readFileSync(resolve("测试用/AI产品经理.pdf"));
    const file = new File([bytes], "AI产品经理.pdf", { type: "application/pdf" });

    const result = await importResumeFile(file);

    expect(result.kind).toBe("pdf");
    expect(result.text.length).toBeGreaterThan(20);
  });

  it("imports the real docx project sample", async () => {
    const bytes = readFileSync(resolve("测试用/项目材料/AI文本功能.docx"));
    const file = new File([bytes], "AI文本功能.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    const result = await importResumeFile(file);

    expect(result.kind).toBe("docx");
    expect(result.text.length).toBeGreaterThan(20);
  });
});
