// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useScheduleStore } from "./schedule";
import type { Scene } from "../types";

function cloneScene(scene: Scene, patch: Partial<Scene>): Scene {
  return { ...JSON.parse(JSON.stringify(scene)) as Scene, ...patch };
}

function setup(scenePatch?: (scenes: Scene[]) => Scene[]) {
  localStorage.clear();
  setActivePinia(createPinia());
  const store = useScheduleStore();
  if (scenePatch) {
    const patched = scenePatch(JSON.parse(JSON.stringify(store.scenes)) as Scene[]);
    store.scenes.splice(0, store.scenes.length, ...patched);
  }
  return store;
}

describe("离线草稿合并", () => {
  beforeEach(() => localStorage.clear());

  it("草稿未动的场次跟随最新通告", () => {
    const store = setup();
    store.snapshot("v1");
    store.saveDraft();
    // 回组后正式通告改了 s1
    const s1 = store.scenes.find((s) => s.id === "s1")!;
    s1.title = "码头交接（改）";
    s1.status = "拍摄中";

    const plan = store.buildMergePlan()!;
    const row = plan.rows.find((r) => r.sceneId === "s1")!;
    expect(row.kind).toBe("officialOnly");
    expect(store.defaultChoice(row)).toBe("official");
    expect(plan.staleReasons).toHaveLength(0);

    const result = store.commitMerge({}, "制片");
    expect(result.ok).toBe(true);
    expect(store.scenes.find((s) => s.id === "s1")!.title).toBe("码头交接（改）");
  });

  it("双方都动过：进对照、默认保留通告，制片确认后才能用草稿覆盖", () => {
    const store = setup();
    store.snapshot("v1");
    store.saveDraft();

    // 通告改 s2 时间
    const officialS2 = store.scenes.find((s) => s.id === "s2")!;
    officialS2.start = "11:00";

    // 草稿改 s2 地点
    const draftS2 = store.draft!.scenes.find((s) => s.id === "s2")!;
    draftS2.locationId = "l2";

    const plan = store.buildMergePlan()!;
    const row = plan.rows.find((r) => r.sceneId === "s2")!;
    expect(row.kind).toBe("both");
    expect(row.fields).toContain("开始时间");
    expect(row.fields).toContain("场地");
    expect(store.defaultChoice(row)).toBe("official");

    // 非制片不能提交
    expect(store.commitMerge({ s2: "draft" }, "场记").ok).toBe(false);

    const result = store.commitMerge({ s2: "draft" }, "制片");
    expect(result.ok).toBe(true);
    const mergedS2 = store.scenes.find((s) => s.id === "s2")!;
    expect(mergedS2.locationId).toBe("l2"); // 草稿覆盖生效
    expect(mergedS2.start).toBe("10:30"); // 整对象来自草稿，保持草稿基线时间
  });

  it("基线版本找不到：同步被标记失效，不能自动套用", () => {
    const store = setup();
    store.snapshot("v1");
    store.saveDraft();
    const draft = JSON.parse(JSON.stringify(store.draft!)) as typeof store.draft;

    // 模拟版本列表被清空（基线找不到）
    store.versions.splice(0, store.versions.length);
    const plan = store.buildMergePlan()!;
    expect(plan.staleReasons.join(" ")).toContain("找不到");

    // 旧草稿缺少基线信息时同样失效
    localStorage.setItem("pair-wise-yf-45/offline-draft", JSON.stringify({ scenes: draft!.scenes, savedAt: draft!.savedAt }));
    store.loadDraft();
    expect(store.buildMergePlan()!.staleReasons.length).toBeGreaterThan(0);
  });

  it("正式通告退回更早版本：同步失效需重新确认", () => {
    const store = setup();
    store.snapshot("v1");
    store.snapshot("v2");
    store.snapshot("v3");
    store.saveDraft(); // 基线 seq=3
    // 回组后正式通告恢复到 v1，headSeq 回到 1（早于草稿基线）
    const v1 = store.versions.find((v) => v.name === "v1")!;
    store.restore(v1.id);
    const reasons = store.buildMergePlan()!.staleReasons;
    expect(reasons.join(" ")).toContain("退回更早版本");
  });

  it("豁免冲突在正式通告改动后需重新确认，重认后重新消失", () => {
    const store = setup();
    // s1、s2 同时间重叠场地 l1，存在场地冲突
    const conflictId = "s1:s2:location";
    expect(store.conflicts.some((c) => c.id === conflictId)).toBe(true);
    store.exempt(conflictId, "制片");
    expect(store.conflicts.some((c) => c.id === conflictId)).toBe(false);

    // 正式通告改动 s1 时间（仍与 s2 重叠），豁免依据失效
    store.scenes.find((s) => s.id === "s1")!.start = "07:00";
    store.scenes.find((s) => s.id === "s1")!.end = "11:00";
    const again = store.conflicts.find((c) => c.id === conflictId);
    expect(again?.exemptionStale).toBe(true);

    store.reconfirmExemption(conflictId, "制片");
    expect(store.conflicts.some((c) => c.id === conflictId)).toBe(false);
  });

  it("合并记录标明每场来自草稿还是正式通告", () => {
    const store = setup();
    store.snapshot("v1");
    store.saveDraft();
    // 草稿改 s1，通告改 s2
    store.draft!.scenes.find((s) => s.id === "s1")!.title = "草稿改名";
    store.scenes.find((s) => s.id === "s2")!.title = "通告改名";

    store.commitMerge({}, "制片");
    const record = store.mergeRecords[0];
    const s1 = record.items.find((i) => i.sceneId === "s1")!;
    const s2 = record.items.find((i) => i.sceneId === "s2")!;
    expect(s1.source).toBe("draft");
    expect(s2.source).toBe("official");
    expect(record.fromDraft).toBe(1);
    expect(record.fromOfficial).toBeGreaterThanOrEqual(2);
  });

  it("草稿新增的场次默认跳过，制片选择后可收进来", () => {
    const store = setup();
    store.snapshot("v1");
    store.saveDraft();
    const base = store.draft!.scenes[0];
    store.draft!.scenes.push(cloneScene(base, { id: "s99", code: "C-099", title: "草稿新场" }));
    const plan = store.buildMergePlan()!;
    const row = plan.rows.find((r) => r.sceneId === "s99")!;
    expect(row.kind).toBe("added");
    expect(store.defaultChoice(row)).toBe("skip");
    store.commitMerge({ s99: "draft" }, "制片");
    expect(store.scenes.some((s) => s.id === "s99")).toBe(true);
  });
});
