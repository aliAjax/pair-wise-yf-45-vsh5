<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { toTypedSchema } from "@vee-validate/zod";
import { useForm } from "vee-validate";
import { z } from "zod";
import { useScheduleStore } from "../stores/schedule";
import type { Scene, SceneStatus } from "../types";

const store = useScheduleStore();
const saving = ref(false);
const dragging = ref<number | null>(null);
const mergeVisible = ref(false);
const overrides = reactive<Record<string, boolean>>({});
const form = reactive({ code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [] as string[], equipmentIds: [] as string[] });
const schema = toTypedSchema(z.object({
  code: z.string().min(2, "请输入场次编号"),
  title: z.string().min(2, "请输入场次名称"),
  day: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  locationId: z.string().min(1)
}));
const { errors, validate } = useForm({ validationSchema: schema });
const editable = computed(() => store.role === "制片" || store.role === "导演");
const producerOverride = computed(() => store.role === "制片");
const mergeAnalysis = computed(() => store.analyzeDraft());
const currentStatus = (status: string) => status as SceneStatus;

onMounted(() => store.loadDraft());

async function submit() {
  const result = await validate({ values: form } as any);
  if (!result.valid) return;
  saving.value = true;
  store.addScene({ code: form.code, title: form.title, day: form.day, start: form.start, end: form.end, locationId: form.locationId, talentIds: [...form.talentIds], equipmentIds: [...form.equipmentIds] });
  Object.assign(form, { code: "", title: "", day: "2026-10-08", start: "08:00", end: "10:00", locationId: "l1", talentIds: [], equipmentIds: [] });
  setTimeout(() => { saving.value = false; }, 240);
}

function drop(index: number) {
  if (dragging.value !== null && editable.value) store.moveScene(dragging.value, index);
  dragging.value = null;
}

function openMerge() {
  Object.keys(overrides).forEach((key) => delete overrides[key]);
  mergeVisible.value = true;
}

function applyMerge() {
  store.applyMerge({ ...overrides });
  mergeVisible.value = false;
}

function describeScene(scene: Scene | undefined) {
  if (!scene) return "—";
  return `${scene.day} ${scene.start}–${scene.end} · ${store.locationName(scene.locationId)} · ${scene.status}`;
}
</script>

<template>
  <section class="page">
    <div class="metrics">
      <article class="metric"><span>通告场次</span><strong>{{ store.scenes.length }}</strong></article>
      <article class="metric"><span>待处理冲突</span><strong>{{ store.conflicts.length }}</strong></article>
      <article class="metric"><span>已确认</span><strong>{{ store.scenes.filter((item: Scene) => item.status === '已确认').length }}</strong></article>
      <article class="metric"><span>版本快照</span><strong>{{ store.versions.length }}</strong></article>
    </div>
    <div v-if="store.draft" class="draft-banner">
      <span>发现 {{ dayjs(store.draft.savedAt).format("MM-DD HH:mm") }} 的离线草稿，共 {{ store.draft.scenes.length }} 个场次。</span>
      <div class="actions"><button class="secondary" @click="openMerge">对照合并</button></div>
    </div>
    <el-dialog v-model="mergeVisible" title="离线草稿对照合并" width="760px">
      <template v-if="mergeAnalysis">
        <el-alert v-if="mergeAnalysis.baselineMissing" type="error" :closable="false" show-icon title="基线版本缺失：无法判断草稿改动范围，本次同步需重新确认，不能套用旧基线" style="margin-bottom:12px" />
        <el-alert v-if="mergeAnalysis.officialReverted" type="warning" :closable="false" show-icon title="正式通告已退回更早版本，本次同步需重新确认，不能套用旧基线" style="margin-bottom:12px" />
        <div class="merge-metrics">
          <span>草稿侧 {{ mergeAnalysis.draftCount }} 场</span>
          <span>正式通告 {{ mergeAnalysis.officialCount }} 场</span>
          <span>冲突 {{ mergeAnalysis.conflictCount }} 项</span>
        </div>

        <div v-if="mergeAnalysis.items.some((item) => ['draft-add','draft-change','draft-delete'].includes(item.kind))" class="merge-group">
          <h4>草稿侧改动（将采用草稿）</h4>
          <div v-for="item in mergeAnalysis.items.filter((entry) => ['draft-add','draft-change','draft-delete'].includes(entry.kind))" :key="item.sceneId" class="merge-row draft">
            <b>{{ item.code }}</b> {{ item.title }}
            <small>{{ item.kind === 'draft-delete' ? '草稿删除' : describeScene(item.draft) }}</small>
          </div>
        </div>

        <div v-if="mergeAnalysis.items.some((item) => !['draft-add','draft-change','draft-delete','both-change','both-delete'].includes(item.kind))" class="merge-group">
          <h4>正式通告侧（草稿未改动，跟随正式通告）</h4>
          <div v-for="item in mergeAnalysis.items.filter((entry) => !['draft-add','draft-change','draft-delete','both-change','both-delete'].includes(entry.kind))" :key="item.sceneId" class="merge-row official">
            <b>{{ item.code }}</b> {{ item.title }}
            <small>{{ item.kind === 'official-delete' ? '正式通告删除' : describeScene(item.official) }}</small>
          </div>
        </div>

        <div v-if="mergeAnalysis.conflictCount" class="merge-group">
          <h4>双方都改动（默认保留正式通告，制片确认后才用草稿覆盖）</h4>
          <div v-for="item in mergeAnalysis.items.filter((entry) => ['both-change','both-delete'].includes(entry.kind))" :key="item.sceneId" class="merge-row conflict">
            <div class="merge-conflict-head">
              <b>{{ item.code }}</b> {{ item.title }}
              <el-checkbox v-model="overrides[item.sceneId]" :disabled="!producerOverride">采用草稿覆盖</el-checkbox>
            </div>
            <div class="merge-compare">
              <span>正式通告：{{ item.kind === 'both-delete' ? '已删除' : describeScene(item.official) }}</span>
              <span>草稿：{{ item.kind === 'both-delete' ? '已删除' : describeScene(item.draft) }}</span>
            </div>
          </div>
          <p v-if="!producerOverride" class="muted">仅制片可确认草稿覆盖，当前角色不可覆盖。</p>
        </div>

        <p class="muted" style="margin-top:10px">合并后原有冲突豁免全部失效，需重新确认；新冲突按合并结果重算。</p>
      </template>
      <template #footer>
        <button class="secondary" @click="mergeVisible = false">取消</button>
        <button class="primary" :disabled="!mergeAnalysis" @click="applyMerge">确认合并</button>
      </template>
    </el-dialog>
    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><h2>新增场次</h2><button class="secondary" @click="store.saveDraft">保存离线草稿</button></div>
        <form class="form-grid" @submit.prevent="submit">
          <label class="field"><span>场次编号</span><input v-model="form.code" placeholder="C-018" /><small>{{ errors.code }}</small></label>
          <label class="field"><span>场次名称</span><input v-model="form.title" placeholder="例如：雨夜追踪" /><small>{{ errors.title }}</small></label>
          <label class="field"><span>拍摄日</span><input v-model="form.day" type="date" /></label>
          <label class="field"><span>场地</span><select v-model="form.locationId"><option v-for="item in store.locations" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <label class="field"><span>开始</span><input v-model="form.start" type="time" /></label>
          <label class="field"><span>结束</span><input v-model="form.end" type="time" /></label>
          <label class="field wide"><span>演员档期</span><select v-model="form.talentIds" multiple><option v-for="item in store.talents" :key="item.id" :value="item.id">{{ item.name }} · {{ item.role }}</option></select></label>
          <label class="field wide"><span>器材借用</span><select v-model="form.equipmentIds" multiple><option v-for="item in store.equipment" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <div class="actions wide"><button class="primary" :disabled="saving || !editable">保存为草稿</button><RouterLink class="secondary" to="/conflicts">检查冲突</RouterLink></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>当日通告顺序</h2><small class="muted">拖拽调整拍摄顺序，版本快照后可随时恢复</small></div><button class="primary" :disabled="!editable" @click="store.snapshot()">保存版本</button></div>
        <div class="scene-list">
          <article v-for="(scene,index) in store.sortedScenes" :key="scene.id" class="scene" :class="{ locked: scene.locked, dragging: dragging === index }" draggable="true" @dragstart="dragging=index" @dragover.prevent @drop="drop(index)">
            <b>{{ index + 1 }}</b>
            <div class="scene-code">{{ scene.code }}</div>
            <div class="scene-title"><b>{{ scene.title }}</b><small>{{ scene.start }}–{{ scene.end }} · {{ store.locationName(scene.locationId) }}</small></div>
            <span class="status" :class="scene.status">{{ scene.status }}</span>
            <div class="actions">
              <button class="secondary" :disabled="!editable || scene.locked" @click="store.updateStatus(scene.id, currentStatus(scene.status === '草稿' ? '已确认' : scene.status === '已确认' ? '拍摄中' : scene.status === '拍摄中' ? '已完成' : '已完成'))">推进</button>
              <button class="secondary" :disabled="!editable" @click="store.toggleLock(scene.id)">{{ scene.locked ? "解锁" : "锁定" }}</button>
            </div>
            <div class="scene-meta wide">
              <small>演员：{{ store.talentNames(scene.talentIds).join("、") || "待定" }} · 器材：{{ store.equipmentNames(scene.equipmentIds).join("、") || "无" }}</small>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
