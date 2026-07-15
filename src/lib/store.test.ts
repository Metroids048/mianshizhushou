import { describe, expect, it } from "vitest";
import { createInitialAppState, createPosition, createProfile } from "./interviewEngine";
import { clearIdentityLocalCache, loadDraftState, loadServerSnapshotCache, loadUiPrefs, localOnlyCloudSync, parseImportedState, saveDraftState, saveServerSnapshotCache, saveUiPrefs, serializeAppState } from "./store";

function createStateWithPosition() {
  const profile = createProfile("张晨\nAI 产品运营\n- 做过增长项目");
  const position = createPosition("岗位：AI 产品运营实习生\n公司：字节跳动\n岗位职责：负责增长与数据分析", profile);
  return {
    ...createInitialAppState(),
    profile,
    positions: [position],
    activePositionId: position.id,
  };
}

describe("store", () => {
  it("serializes and re-parses an app state without loss", () => {
    const state = createStateWithPosition();
    const restored = parseImportedState(serializeAppState(state));

    expect(restored.positions).toHaveLength(1);
    expect(restored.activePositionId).toBe(state.activePositionId);
    expect(restored.profile.resumeText).toBe(state.profile.resumeText);
    expect(restored.positions[0].questions.length).toBeGreaterThan(0);
  });

  it("rejects an invalid backup payload", () => {
    expect(() => parseImportedState('{"foo":1}')).toThrow();
  });

  it("normalizes imported app state when the active position is missing", () => {
    const state = createStateWithPosition();
    const imported = parseImportedState(JSON.stringify({ ...state, activePositionId: "missing-position" }));

    expect(imported.activePositionId).toBe(imported.positions[0].id);
    expect(imported.positions[0].notes).toBe("");
  });

  it("preserves synthetic evidence flags through backup serialization", () => {
    const state = createStateWithPosition();
    state.profile.evidenceLibrary = [
      {
        id: "ev-fallback",
        type: "练习推断",
        title: "AI 产品经理（待补真实证据）",
        detail: "当前仅基于摘要推断。",
        keywords: ["AI", "产品"],
        impact: "练习模式推断，需补充真实项目、动作和可验证结果",
        synthetic: true,
      },
    ];

    const restored = parseImportedState(serializeAppState(state));

    expect(restored.profile.evidenceLibrary[0].synthetic).toBe(true);
  });

  it("exposes a local-only cloud sync seam", async () => {
    await expect(localOnlyCloudSync.pull()).rejects.toThrow("CLOUD_SYNC_NOT_CONFIGURED");
  });

  it("clears identity-bound cache while preserving UI preferences", () => {
    const state = createStateWithPosition();
    saveServerSnapshotCache(state);
    saveDraftState({ homeInput: "访客输入的岗位", resumeChatInput: "简历草稿" });
    saveUiPrefs({ desktopSidebarExpanded: false, desktopSidebarTouched: true });
    window.localStorage.setItem("ai-job:guest-id:v1", "guest-before-login");

    clearIdentityLocalCache();

    expect(loadServerSnapshotCache().positions).toHaveLength(0);
    expect(loadDraftState()).toEqual({ homeInput: "", resumeChatInput: "" });
    expect(window.localStorage.getItem("ai-job:guest-id:v1")).toBeNull();
    expect(loadUiPrefs().desktopSidebarExpanded).toBe(false);
    expect(loadUiPrefs().desktopSidebarTouched).toBe(true);
  });
});
