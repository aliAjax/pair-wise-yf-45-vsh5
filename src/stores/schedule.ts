import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type { Conflict, Equipment, HistoryEntry, Location, MergeRecord, MergeRecordItem, OfflineDraft, Role, Scene, SceneStatus, Talent, Version } from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";

export type MergeKind = "draft-add" | "draft-change" | "official-change" | "official-add" | "official-delete" | "draft-delete" | "both-change" | "both-delete" | "unchanged";

export interface MergeDiffItem {
  sceneId: string;
  code: string;
  title: string;
  kind: MergeKind;
  draft?: Scene;
  official?: Scene;
  baseline?: Scene;
}

export interface MergeAnalysis {
  items: MergeDiffItem[];
  baselineMissing: boolean;
  officialReverted: boolean;
  draftCount: number;
  officialCount: number;
  conflictCount: number;
}

const talents: Talent[] = [
  { id: "t1", name: "林川", role: "男主" },
  { id: "t2", name: "周禾", role: "女主" },
  { id: "t3", name: "顾言", role: "配角" },
  { id: "t4", name: "孙宁", role: "群演领队" }
];

const locations: Location[] = [
  { id: "l1", name: "老码头" },
  { id: "l2", name: "玻璃厂房" },
  { id: "l3", name: "南站候车厅" }
];

const equipment: Equipment[] = [
  { id: "e1", name: "ARRI A机" },
  { id: "e2", name: "移动伸缩炮" },
  { id: "e3", name: "LED灯组" },
  { id: "e4", name: "跟拍车" }
];

const seedScenes: Scene[] = [
  { id: "s1", code: "A-012", title: "码头交接", day: "2026-10-08", start: "08:00", end: "11:30", talentIds: ["t1", "t3"], locationId: "l1", equipmentIds: ["e1", "e3"], status: "已确认", locked: false },
  { id: "s2", code: "A-013", title: "厂房追逐", day: "2026-10-08", start: "10:30", end: "13:00", talentIds: ["t1", "t2"], locationId: "l1", equipmentIds: ["e2", "e4"], status: "草稿", locked: false },
  { id: "s3", code: "B-021", title: "候车厅告别", day: "2026-10-09", start: "15:00", end: "18:30", talentIds: ["t2", "t3"], locationId: "l3", equipmentIds: ["e1"], status: "草稿", locked: false }
];

function readScenes(): Scene[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).scenes as Scene[] : clone(seedScenes);
  } catch {
    return clone(seedScenes);
  }
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).history as HistoryEntry[] : [];
  } catch {
    return [];
  }
}

function readVersions(): Version[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw).versions as Version[] : [];
  } catch {
    return [];
  }
}

function readMergeRecords(): MergeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw).mergeRecords as MergeRecord[]) : [];
  } catch {
    return [];
  }
}

function sameStringSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function sceneEqual(a: Scene, b: Scene): boolean {
  return a.id === b.id
    && a.code === b.code
    && a.title === b.title
    && a.day === b.day
    && a.start === b.start
    && a.end === b.end
    && a.locationId === b.locationId
    && a.status === b.status
    && a.locked === b.locked
    && sameStringSet(a.talentIds, b.talentIds)
    && sameStringSet(a.equipmentIds, b.equipmentIds);
}

function scenesEqual(a: Scene[], b: Scene[]): boolean {
  if (a.length !== b.length) return false;
  const map = new Map(b.map((scene) => [scene.id, scene]));
  return a.every((scene) => {
    const other = map.get(scene.id);
    return other ? sceneEqual(scene, other) : false;
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function overlaps(a: Scene, b: Scene) {
  return a.day === b.day && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end);
}

function shared(a: string[], b: string[]) {
  return a.some((value) => b.includes(value));
}

export const useScheduleStore = defineStore("schedule", () => {
  const scenes = ref<Scene[]>(readScenes());
  const history = ref<HistoryEntry[]>(readHistory());
  const versions = ref<Version[]>(readVersions());
  const mergeRecords = ref<MergeRecord[]>(readMergeRecords());
  const role = ref<Role>("制片");
  const exemptions = ref<string[]>([]);
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(null);

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const id = `${a.id}:${b.id}`;
        if (exemptions.value.includes(id)) continue;
        if (shared(a.talentIds, b.talentIds)) result.push({ id: `${id}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, severity: "高" });
        if (a.locationId === b.locationId) result.push({ id: `${id}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高" });
        if (shared(a.equipmentIds, b.equipmentIds)) result.push({ id: `${id}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, severity: "中" });
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30) result.push({ id: `${id}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中" });
      }
    }
    return result;
  });

  const sortedScenes = computed(() => [...scenes.value].sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`)));

  function log(action: string, detail: string) {
    history.value.unshift({ id: crypto.randomUUID(), action, detail, time: new Date().toISOString() });
    history.value = history.value.slice(0, 80);
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value, mergeRecords: mergeRecords.value }));
  }

  watch([scenes, history, versions, mergeRecords], persist, { deep: true });

  function addScene(input: Omit<Scene, "id" | "status" | "locked">) {
    scenes.value.push({ ...input, id: crypto.randomUUID(), status: "草稿", locked: false });
    log("新增场次", `${input.code} ${input.title}`);
  }

  function updateStatus(id: string, status: SceneStatus) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene || scene.locked) return;
    scene.status = status;
    log("流转状态", `${scene.code} → ${status}`);
  }

  function toggleLock(id: string) {
    const scene = scenes.value.find((item) => item.id === id);
    if (!scene) return;
    scene.locked = !scene.locked;
    log(scene.locked ? "锁定场次" : "解锁场次", scene.code);
  }

  function moveScene(from: number, to: number) {
    if (from === to || to < 0 || to >= scenes.value.length) return;
    const [item] = scenes.value.splice(from, 1);
    scenes.value.splice(to, 0, item);
    log("调整顺序", `${item.code} 移至第 ${to + 1} 位`);
  }

  function snapshot(name = `版本 ${versions.value.length + 1}`) {
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: clone(scenes.value) });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = clone(version.scenes);
    log("恢复版本", version.name);
  }

  function saveDraft() {
    const baselineVersionId = versions.value.find((version) => scenesEqual(version.scenes, scenes.value))?.id;
    draft.value = {
      scenes: clone(scenes.value),
      savedAt: new Date().toISOString(),
      baselineScenes: clone(scenes.value),
      baselineVersionId
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", `${dayjs(draft.value.savedAt).format("MM-DD HH:mm")} · 基线已留存（${baselineVersionId ? "版本快照" : "当前通告"}）`);
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      draft.value = raw ? JSON.parse(raw) as OfflineDraft : null;
    } catch {
      draft.value = null;
    }
  }

  function detectRevert(official: Scene[], baseline: Scene[], savedAt: string): boolean {
    if (scenesEqual(official, baseline)) return false;
    const older = versions.value.filter((version) => version.time < savedAt);
    return older.some((version) => scenesEqual(official, version.scenes));
  }

  function analyzeDraft(): MergeAnalysis | null {
    if (!draft.value) return null;
    const saved = draft.value;
    const baseline = saved.baselineScenes;
    const official = scenes.value;
    const baselineMissing = !baseline;
    const officialReverted = baseline ? detectRevert(official, baseline, saved.savedAt) : false;

    const ids = new Set<string>();
    saved.scenes.forEach((scene) => ids.add(scene.id));
    official.forEach((scene) => ids.add(scene.id));
    (baseline ?? []).forEach((scene) => ids.add(scene.id));

    const items: MergeDiffItem[] = [];
    for (const id of ids) {
      const draftScene = saved.scenes.find((scene) => scene.id === id);
      const officialScene = official.find((scene) => scene.id === id);
      const baselineScene = baseline?.find((scene) => scene.id === id);
      const code = draftScene?.code ?? officialScene?.code ?? baselineScene?.code ?? "";
      const title = draftScene?.title ?? officialScene?.title ?? baselineScene?.title ?? "";

      let kind: MergeKind;
      if (baselineMissing || !baselineScene) {
        if (draftScene && officialScene) {
          kind = sceneEqual(draftScene, officialScene) ? "unchanged" : "both-change";
        } else if (draftScene) {
          kind = "draft-add";
        } else {
          kind = "official-add";
        }
      } else {
        const draftChanged = !!draftScene && !sceneEqual(draftScene, baselineScene);
        const draftDeleted = !draftScene;
        const officialChanged = !!officialScene && !sceneEqual(officialScene, baselineScene);
        const officialDeleted = !officialScene;
        if (!draftChanged && !draftDeleted) {
          kind = officialDeleted ? "official-delete" : officialChanged ? "official-change" : "unchanged";
        } else if (!officialChanged && !officialDeleted) {
          kind = draftDeleted ? "draft-delete" : "draft-change";
        } else {
          kind = draftDeleted && officialDeleted ? "both-delete" : "both-change";
        }
      }

      items.push({ sceneId: id, code, title, kind, draft: draftScene, official: officialScene, baseline: baselineScene });
    }

    return {
      items,
      baselineMissing,
      officialReverted,
      draftCount: items.filter((item) => ["draft-add", "draft-change", "draft-delete"].includes(item.kind)).length,
      officialCount: items.filter((item) => ["official-change", "official-add", "official-delete"].includes(item.kind)).length,
      conflictCount: items.filter((item) => ["both-change", "both-delete"].includes(item.kind)).length
    };
  }

  function applyMerge(overrides: Record<string, boolean> = {}) {
    const analysis = analyzeDraft();
    if (!analysis || !draft.value) return;
    const producerOverride = role.value === "制片";
    const merged: Scene[] = [];
    const recordItems: MergeRecordItem[] = [];
    let draftCount = 0;
    let officialCount = 0;
    let overrideCount = 0;

    for (const item of analysis.items) {
      let chosen: Scene | null = null;
      let source: "draft" | "official" = "official";
      let reason = "";
      switch (item.kind) {
        case "draft-add":
          chosen = item.draft!;
          source = "draft";
          reason = "草稿新增场次";
          break;
        case "draft-change":
          chosen = item.draft!;
          source = "draft";
          reason = "草稿侧修改，正式通告未改动";
          break;
        case "draft-delete":
          source = "draft";
          reason = "草稿删除，正式通告未改动";
          break;
        case "official-add":
          chosen = item.official!;
          source = "official";
          reason = "正式通告新增场次";
          break;
        case "official-change":
          chosen = item.official!;
          source = "official";
          reason = "正式通告侧更新，草稿未改动";
          break;
        case "official-delete":
          source = "official";
          reason = "正式通告删除，草稿未改动";
          break;
        case "unchanged":
          chosen = item.official ?? item.draft!;
          source = "official";
          reason = "草稿未改动，跟随正式通告";
          break;
        case "both-change":
        case "both-delete": {
          const wantDraft = producerOverride && !!overrides[item.sceneId];
          if (wantDraft) {
            if (item.draft) {
              chosen = item.draft;
              source = "draft";
              reason = "双方改动，制片确认采用草稿覆盖";
              overrideCount += 1;
            } else {
              source = "draft";
              reason = "双方均删除，制片确认按草稿删除";
            }
          } else if (item.kind === "both-delete") {
            source = "official";
            reason = "双方均删除";
          } else {
            chosen = item.official ?? null;
            source = "official";
            reason = "双方改动，默认保留正式通告";
          }
          break;
        }
      }
      if (chosen) merged.push(chosen);
      recordItems.push({ sceneId: item.sceneId, code: item.code, title: item.title, source, reason });
      if (source === "draft") draftCount += 1; else officialCount += 1;
    }

    scenes.value = merged;
    exemptions.value = [];
    const record: MergeRecord = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      draftSavedAt: draft.value.savedAt,
      baselineMissing: analysis.baselineMissing,
      officialReverted: analysis.officialReverted,
      operator: role.value,
      items: recordItems,
      summary: { total: recordItems.length, draft: draftCount, official: officialCount, overrides: overrideCount }
    };
    mergeRecords.value.unshift(record);
    mergeRecords.value = mergeRecords.value.slice(0, 20);
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);

    log("合并离线草稿", `草稿 ${draftCount} 场 / 正式通告 ${officialCount} 场，草稿覆盖 ${overrideCount} 场`);
    if (analysis.baselineMissing) log("同步需重新确认", "基线版本缺失，本次按无基线对照合并");
    if (analysis.officialReverted) log("同步需重新确认", "正式通告已退回更早版本，本次按现状对照合并");
    log("冲突豁免重新确认", "正式通告已更新，原有冲突豁免全部失效，请重新评估");
  }

  function exempt(id: string) {
    exemptions.value.push(id);
    log("豁免冲突", id);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return { scenes, sortedScenes, conflicts, history, versions, mergeRecords, role, exemptions, online, draft, talents, locations, equipment, talentNames, equipmentNames, locationName, addScene, updateStatus, toggleLock, moveScene, snapshot, restore, saveDraft, loadDraft, analyzeDraft, applyMerge, exempt, setOnline };
});
