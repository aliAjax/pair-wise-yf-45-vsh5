export type Role = "制片" | "导演" | "演员统筹" | "场记";
export type SceneStatus = "草稿" | "已确认" | "拍摄中" | "已完成";
export type ConflictType = "演员档期" | "场地占用" | "器材借用" | "转场时间";

export interface Talent {
  id: string;
  name: string;
  role: string;
}

export interface Location {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  name: string;
}

export interface Scene {
  id: string;
  code: string;
  title: string;
  day: string;
  start: string;
  end: string;
  talentIds: string[];
  locationId: string;
  equipmentIds: string[];
  status: SceneStatus;
  locked: boolean;
}

export interface Conflict {
  id: string;
  type: ConflictType;
  sceneIds: string[];
  message: string;
  severity: "高" | "中";
  /** 该冲突曾被豁免，但合并/改动后原豁免依据已失效，需要重新确认 */
  exemptionStale?: boolean;
}

export interface HistoryEntry {
  id: string;
  action: string;
  detail: string;
  time: string;
}

export interface Version {
  id: string;
  name: string;
  time: string;
  scenes: Scene[];
  /** 单调版本序号，用于识别正式通告是否退回到更早版本 */
  seq: number;
}

export interface OfflineDraft {
  scenes: Scene[];
  savedAt: string;
  /** 保存草稿时正式通告的版本序号与基线快照 */
  baselineSeq: number;
  baselineVersionId?: string;
  baselineVersionName?: string;
  baselineScenes: Scene[];
  baselineFp: Record<string, string>;
}

export type MergeRowKind =
  | "unchanged"
  | "officialOnly"
  | "draftOnly"
  | "both"
  | "added"
  | "deletedDraft";

export type MergeChoice = "official" | "draft" | "skip";

export interface MergeRow {
  sceneId: string;
  code: string;
  kind: MergeRowKind;
  baseline?: Scene;
  official?: Scene;
  draft?: Scene;
  /** 双方都改动时，存在差异的字段名 */
  fields: string[];
}

export interface MergePlan {
  rows: MergeRow[];
  /** 基线失效原因（找不到基线版本 / 正式通告退回更早版本 / 基线信息缺失），非空时整次同步需制片重新确认 */
  staleReasons: string[];
}

export interface MergeSceneItem {
  sceneId: string;
  code: string;
  title: string;
  kind: MergeRowKind;
  /** merged 中该场次最终取自哪里 */
  source: "official" | "draft" | "skipped";
}

export interface MergeRecord {
  id: string;
  time: string;
  draftSavedAt: string;
  baselineSeq: number;
  baselineVersionName?: string;
  stale: boolean;
  confirmedBy?: Role;
  items: MergeSceneItem[];
  fromDraft: number;
  fromOfficial: number;
  skipped: number;
}

export interface ExemptionRecord {
  /** 与冲突 id 相同，如 s1:s2:talent */
  id: string;
  /** 豁免时两场戏关键字段的签名，签名变化则豁免需重新确认 */
  signature: string;
  time: string;
  by: Role;
}
