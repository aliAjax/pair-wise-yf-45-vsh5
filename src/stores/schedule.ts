import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import dayjs from "dayjs";
import type {
  Conflict,
  Equipment,
  ExemptionRecord,
  HistoryEntry,
  Location,
  MergeChoice,
  MergePlan,
  MergeRecord,
  MergeRow,
  OfflineDraft,
  Role,
  Scene,
  SceneStatus,
  Talent,
  Version
} from "../types";

const STORAGE_KEY = "pair-wise-yf-45/schedule-v1";
const DRAFT_KEY = "pair-wise-yf-45/offline-draft";
const EXEMPTION_KEY = "pair-wise-yf-45/exemptions";
const MERGE_KEY = "pair-wise-yf-45/merge-records";

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

interface PersistShape {
  scenes?: Scene[];
  history?: HistoryEntry[];
  versions?: Version[];
  headSeq?: number;
}

function parseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 深拷贝：数据全部为可 JSON 序列化结构，同时兼容响应式代理环境（如测试中的 jsdom） */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readPersist(): PersistShape {
  return parseJSON<PersistShape>(localStorage.getItem(STORAGE_KEY), {});
}

function readScenes(): Scene[] {
  const persisted = readPersist();
  return persisted.scenes ? persisted.scenes : clone(seedScenes);
}

function readHistory(): HistoryEntry[] {
  return readPersist().history ?? [];
}

function readVersions(): Version[] {
  const versions = readPersist().versions ?? [];
  // 兼容旧版本数据：补全单调序号
  return versions.map((item, index) => ({ ...item, seq: item.seq ?? versions.length - index }));
}

function readHeadSeq(): number {
  const persisted = readPersist();
  if (typeof persisted.headSeq === "number") return persisted.headSeq;
  return (persisted.versions?.length ?? 0);
}

function readExemptions(): ExemptionRecord[] {
  return parseJSON<ExemptionRecord[]>(localStorage.getItem(EXEMPTION_KEY), []);
}

function readMergeRecords(): MergeRecord[] {
  return parseJSON<MergeRecord[]>(localStorage.getItem(MERGE_KEY), []);
}

function readDraft(): OfflineDraft | null {
  const raw = parseJSON<(OfflineDraft & { baselineSeq?: number; baselineScenes?: Scene[]; baselineFp?: Record<string, string> }) | null>(localStorage.getItem(DRAFT_KEY), null);
  if (!raw) return null;
  // 旧版草稿缺少基线信息，按基线缺失处理，不能直接套用
  if (typeof raw.baselineSeq !== "number" || !raw.baselineScenes || !raw.baselineFp) {
    return {
      scenes: raw.scenes ?? [],
      savedAt: raw.savedAt,
      baselineSeq: -1,
      baselineScenes: [],
      baselineFp: {}
    };
  }
  return raw as OfflineDraft;
}

const COMPARE_FIELDS = ["code", "title", "day", "start", "end", "talentIds", "locationId", "equipmentIds", "status", "locked"] as const;
type CompareField = (typeof COMPARE_FIELDS)[number];

const FIELD_LABELS: Record<CompareField, string> = {
  code: "场次编号",
  title: "场次名称",
  day: "拍摄日",
  start: "开始时间",
  end: "结束时间",
  talentIds: "演员",
  locationId: "场地",
  equipmentIds: "器材",
  status: "状态",
  locked: "锁定"
};

/** 场次内容指纹：排除 id，字段按固定顺序输出 */
function sceneFp(scene: Scene): string {
  const body = COMPARE_FIELDS.map((field) => {
    const value = scene[field];
    return Array.isArray(value) ? [...value].sort().join(",") : String(value);
  }).join("|");
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) {
    hash = (hash * 31 + body.charCodeAt(i)) | 0;
  }
  return `fp-${(hash >>> 0).toString(36)}-${body.length}`;
}

/** 豁免签名：只覆盖会影响冲突判定的关键字段 */
function conflictSignature(scene: Scene): string {
  const value = [scene.day, scene.start, scene.end, scene.locationId, [...scene.talentIds].sort().join(","), [...scene.equipmentIds].sort().join(",")].join("|");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
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
  const headSeq = ref<number>(readHeadSeq());
  const role = ref<Role>("制片");
  const exemptionRecords = ref<ExemptionRecord[]>(readExemptions());
  const mergeRecords = ref<MergeRecord[]>(readMergeRecords());
  const online = ref(navigator.onLine);
  const draft = ref<OfflineDraft | null>(readDraft());

  const talentNames = (ids: string[]) => ids.map((id) => talents.find((item) => item.id === id)?.name ?? id);
  const locationName = (id: string) => locations.find((item) => item.id === id)?.name ?? id;
  const equipmentNames = (ids: string[]) => ids.map((id) => equipment.find((item) => item.id === id)?.name ?? id);

  /** 计算当前全部原始冲突；豁免依据失效的冲突标记 exemptionStale */
  const conflicts = computed<Conflict[]>(() => {
    const result: Conflict[] = [];
    for (let i = 0; i < scenes.value.length; i += 1) {
      for (let j = i + 1; j < scenes.value.length; j += 1) {
        const a = scenes.value[i];
        const b = scenes.value[j];
        if (!overlaps(a, b)) continue;
        const pairId = `${a.id}:${b.id}`;
        const signature = a && b ? `${conflictSignature(a)}/${conflictSignature(b)}` : "";
        /** 有效豁免压制冲突；豁免依据失效时保留冲突并打上重新确认标记 */
        const mark = (conflictId: string): { exemptionStale?: boolean } | null => {
          const exemption = exemptionRecords.value.find((item) => item.id === conflictId);
          if (!exemption) return {};
          return exemption.signature !== signature ? { exemptionStale: true } : null;
        };
        const talentStamp = mark(`${pairId}:talent`);
        if (shared(a.talentIds, b.talentIds) && talentStamp) result.push({ id: `${pairId}:talent`, type: "演员档期", sceneIds: [a.id, b.id], message: `${talentNames(a.talentIds.filter((item) => b.talentIds.includes(item))).join("、")} 在两场戏中档期重叠`, severity: "高", ...talentStamp });
        const locationStamp = mark(`${pairId}:location`);
        if (a.locationId === b.locationId && locationStamp) result.push({ id: `${pairId}:location`, type: "场地占用", sceneIds: [a.id, b.id], message: `${locationName(a.locationId)} 被同时占用`, severity: "高", ...locationStamp });
        const equipmentStamp = mark(`${pairId}:equipment`);
        if (shared(a.equipmentIds, b.equipmentIds) && equipmentStamp) result.push({ id: `${pairId}:equipment`, type: "器材借用", sceneIds: [a.id, b.id], message: `${equipmentNames(a.equipmentIds.filter((item) => b.equipmentIds.includes(item))).join("、")} 发生借用重叠`, severity: "中", ...equipmentStamp });
        const transferStamp = mark(`${pairId}:transfer`);
        if (a.locationId !== b.locationId && minutes(b.start) - minutes(a.end) < 30 && transferStamp) result.push({ id: `${pairId}:transfer`, type: "转场时间", sceneIds: [a.id, b.id], message: "两个场地之间转场时间不足30分钟", severity: "中", ...transferStamp });
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ scenes: scenes.value, history: history.value, versions: versions.value, headSeq: headSeq.value }));
    localStorage.setItem(EXEMPTION_KEY, JSON.stringify(exemptionRecords.value));
    localStorage.setItem(MERGE_KEY, JSON.stringify(mergeRecords.value));
  }

  watch([scenes, history, versions, headSeq, exemptionRecords, mergeRecords], persist, { deep: true });

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

  function snapshot(name = `版本 ${headSeq.value + 1}`) {
    headSeq.value += 1;
    versions.value.unshift({ id: crypto.randomUUID(), name, time: new Date().toISOString(), scenes: clone(scenes.value), seq: headSeq.value });
    versions.value = versions.value.slice(0, 12);
    log("保存版本", name);
  }

  function restore(id: string) {
    const version = versions.value.find((item) => item.id === id);
    if (!version) return;
    scenes.value = clone(version.scenes);
    headSeq.value = version.seq;
    log("恢复版本", `${version.name}（序号 ${version.seq}）`);
  }

  /** 场记离开片场：保存带基线的离线草稿 */
  function saveDraft() {
    const baselineScenes = clone(scenes.value);
    const baselineFp: Record<string, string> = {};
    baselineScenes.forEach((scene) => { baselineFp[scene.id] = sceneFp(scene); });
    const latest = versions.value[0];
    draft.value = {
      scenes: clone(baselineScenes),
      savedAt: new Date().toISOString(),
      baselineSeq: headSeq.value,
      baselineVersionId: latest?.id,
      baselineVersionName: latest?.name,
      baselineScenes,
      baselineFp
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft.value));
    log("保存离线草稿", `${dayjs(draft.value.savedAt).format("MM-DD HH:mm")} · 基线序号 ${headSeq.value}`);
  }

  function loadDraft() {
    draft.value = readDraft();
  }

  function discardDraft() {
    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
    log("放弃离线草稿", "未合并任何场次");
  }

  /** 基线校验：基线版本找不到，或正式通告退回到基线之前的版本，均需重新确认 */
  function evaluateBaseline(target: OfflineDraft): string[] {
    const reasons: string[] = [];
    if (target.baselineSeq < 0 || (!target.baselineVersionId && target.baselineScenes.length === 0)) {
      reasons.push("保存草稿时使用的基线版本已找不到，本次同步不能自动套用，需制片重新确认。");
      return reasons;
    }
    if (target.baselineVersionId && !versions.value.some((item) => item.id === target.baselineVersionId)) {
      reasons.push(`草稿基线「${target.baselineVersionName ?? `序号 ${target.baselineSeq}`}」在版本列表中找不到，本次同步不能自动套用，需制片重新确认。`);
    }
    if (headSeq.value < target.baselineSeq) {
      reasons.push(`正式通告已退回更早版本（当前序号 ${headSeq.value}，草稿基线序号 ${target.baselineSeq}），本次同步不能自动套用，需制片重新确认。`);
    }
    return reasons;
  }

  function rowLabel(row: MergeRow): string {
    const scene = row.official ?? row.draft ?? row.baseline;
    return scene ? `${scene.code} ${scene.title}` : row.sceneId;
  }

  function changedFields(draftScene: Scene, officialScene: Scene): string[] {
    return COMPARE_FIELDS.filter((field) => {
      const dv = draftScene[field];
      const ov = officialScene[field];
      return Array.isArray(dv) || Array.isArray(ov)
        ? JSON.stringify([...(dv as string[])].sort()) !== JSON.stringify([...(ov as string[])].sort())
        : dv !== ov;
    }).map((field) => FIELD_LABELS[field]);
  }

  /** 三向对比生成合并对照：未动跟随通告 / 单边改动直接收 / 双方都动进对照默认保留通告 */
  function buildMergePlan(): MergePlan | null {
    if (!draft.value) return null;
    const target = draft.value;
    const staleReasons = evaluateBaseline(target);

    const officialMap = new Map(scenes.value.map((scene) => [scene.id, scene]));
    const draftMap = new Map(target.scenes.map((scene) => [scene.id, scene]));
    const ids = Array.from(new Set([...target.baselineScenes.map((scene) => scene.id), ...scenes.value.map((scene) => scene.id), ...target.scenes.map((scene) => scene.id)]));

    const rows: MergeRow[] = ids.map((id) => {
      const baseline = target.baselineScenes.find((scene) => scene.id === id);
      const official = officialMap.get(id);
      const draftScene = draftMap.get(id);
      const baseFp = baseline ? target.baselineFp[id] : undefined;
      const offFp = official ? sceneFp(official) : undefined;
      const draftFp = draftScene ? sceneFp(draftScene) : undefined;
      const labelSource = official ?? draftScene ?? baseline;
      const code = labelSource?.code ?? id;

      if (baseline) {
        const officialChanged = !official || offFp !== baseFp;
        const draftChanged = !draftScene || draftFp !== baseFp;
        if (!officialChanged && !draftChanged) {
          return { sceneId: id, code, kind: "unchanged", baseline, official, draft: draftScene, fields: [] };
        }
        if (officialChanged && !draftChanged) {
          return { sceneId: id, code, kind: "officialOnly", baseline, official, draft: draftScene, fields: [] };
        }
        if (!officialChanged && draftChanged) {
          return { sceneId: id, code, kind: draftScene ? "draftOnly" : "deletedDraft", baseline, official, draft: draftScene, fields: [] };
        }
        return { sceneId: id, code, kind: "both", baseline, official, draft: draftScene, fields: official && draftScene ? changedFields(draftScene, official) : [] };
      }
      // 基线中不存在：正式新增跟随通告；仅草稿新增默认跳过
      if (official) return { sceneId: id, code, kind: "added", official, draft: draftScene, fields: [] };
      return { sceneId: id, code, kind: "added", draft: draftScene, fields: [] };
    });

    const order: Record<MergeRow["kind"], number> = { both: 0, draftOnly: 1, deletedDraft: 2, officialOnly: 3, unchanged: 4, added: 5 };
    rows.sort((a, b) => order[a.kind] - order[b.kind] || a.code.localeCompare(b.code));
    return { rows, staleReasons };
  }

  /** 每个场次的默认选择：双方都动默认正式通告；草稿删除默认保留通告 */
  function defaultChoice(row: MergeRow): MergeChoice {
    if (row.kind === "draftOnly") return "draft";
    if (row.kind === "both") return "official";
    if (row.kind === "deletedDraft") return "official";
    if (row.kind === "added" && !row.official && row.draft) return "skip";
    return "official";
  }

  /** 制片确认后执行合并，落合并记录，原冲突豁免按合并结果重算 */
  function commitMerge(choices: Record<string, MergeChoice>, confirmedBy: Role): { ok: boolean; message?: string; record?: MergeRecord } {
    if (!draft.value) return { ok: false, message: "没有待合并的草稿" };
    if (confirmedBy !== "制片") return { ok: false, message: "只有制片确认后才能完成合并" };

    const plan = buildMergePlan();
    if (!plan) return { ok: false, message: "无法生成合并对照" };

    // 合并前留版本快照，便于回看与撤销
    snapshot(`合并前自动快照 ${dayjs().format("MM-DD HH:mm")}`);

    const items: MergeRecord["items"] = [];
    const merged: Scene[] = [];
    const choiceById = new Map(plan.rows.map((row) => [row.sceneId, choices[row.sceneId] ?? defaultChoice(row)]));

    plan.rows.forEach((row) => {
      const choice = choiceById.get(row.sceneId) ?? defaultChoice(row);
      if (choice === "draft") {
        // 草稿侧删除（row.draft 不存在）也作为“采用草稿”，合并结果中不再保留该场
        if (row.draft) {
          merged.push(clone(row.draft));
          items.push({ sceneId: row.sceneId, code: row.code, title: row.draft.title, kind: row.kind, source: "draft" });
        } else {
          const labelScene = row.official ?? row.baseline;
          items.push({ sceneId: row.sceneId, code: row.code, title: labelScene?.title ?? "", kind: row.kind, source: "draft" });
        }
      } else if (row.official && choice !== "skip") {
        merged.push(clone(row.official));
        items.push({ sceneId: row.sceneId, code: row.code, title: row.official.title, kind: row.kind, source: "official" });
      } else {
        const labelScene = row.draft ?? row.official ?? row.baseline;
        items.push({ sceneId: row.sceneId, code: row.code, title: labelScene?.title ?? "", kind: row.kind, source: "skipped" });
      }
    });

    scenes.value = merged.sort((a, b) => `${a.day} ${a.start}`.localeCompare(`${b.day} ${b.start}`));

    // 原豁免按合并结果重新校验：签名变化的保留记录但不再压制冲突，需重新确认；消失的冲突自动隐藏
    // （exemptionRecords 原样保留，conflicts 计算时用新签名比对）

    const record: MergeRecord = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      draftSavedAt: draft.value.savedAt,
      baselineSeq: draft.value.baselineSeq,
      baselineVersionName: draft.value.baselineVersionName,
      stale: plan.staleReasons.length > 0,
      confirmedBy,
      items,
      fromDraft: items.filter((item) => item.source === "draft").length,
      fromOfficial: items.filter((item) => item.source === "official").length,
      skipped: items.filter((item) => item.source === "skipped").length
    };
    mergeRecords.value.unshift(record);
    mergeRecords.value = mergeRecords.value.slice(0, 20);

    log("合并离线草稿", `草稿来源 ${record.fromDraft} 场 · 正式通告 ${record.fromOfficial} 场 · 跳过 ${record.skipped} 场${record.stale ? " · 基线失效已重新确认" : ""}`);

    draft.value = null;
    localStorage.removeItem(DRAFT_KEY);
    return { ok: true, record };
  }

  function pairSignatureOf(conflictId: string): string | null {
    const [aId, bId] = conflictId.split(":");
    const a = scenes.value.find((scene) => scene.id === aId);
    const b = scenes.value.find((scene) => scene.id === bId);
    if (!a || !b) return null;
    return `${conflictSignature(a)}/${conflictSignature(b)}`;
  }

  function exempt(id: string, by: Role = role.value) {
    const signature = pairSignatureOf(id);
    if (!signature) return;
    exemptionRecords.value = exemptionRecords.value.filter((item) => item.id !== id);
    exemptionRecords.value.push({ id, signature, time: new Date().toISOString(), by });
    log("豁免冲突", id);
  }

  /** 正式通告改动导致豁免依据失效后，重新确认豁免 */
  function reconfirmExemption(id: string, by: Role = role.value) {
    const signature = pairSignatureOf(id);
    if (!signature) return;
    const record = exemptionRecords.value.find((item) => item.id === id);
    if (record) record.signature = signature;
    else exemptionRecords.value.push({ id, signature, time: new Date().toISOString(), by });
    log("重新确认豁免", id);
  }

  function setOnline(value: boolean) {
    online.value = value;
  }

  return {
    scenes, sortedScenes, conflicts, history, versions, headSeq, role, exemptionRecords, mergeRecords,
    online, draft, talents, locations, equipment, talentNames, equipmentNames, locationName,
    addScene, updateStatus, toggleLock, moveScene, snapshot, restore,
    saveDraft, loadDraft, discardDraft, buildMergePlan, defaultChoice, commitMerge, evaluateBaseline, rowLabel,
    exempt, reconfirmExemption, setOnline
  };
});
