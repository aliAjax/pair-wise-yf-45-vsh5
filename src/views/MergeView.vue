<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";
import type { MergeChoice, MergeRow, Scene } from "../types";

const store = useScheduleStore();

const plan = computed(() => store.buildMergePlan());

const choices = reactive<Record<string, MergeChoice>>({});

watch(plan, (value) => {
  if (!value) return;
  value.rows.forEach((row) => {
    if (!choices[row.sceneId]) choices[row.sceneId] = store.defaultChoice(row);
  });
}, { immediate: true });

// 换了一份新草稿（或合并完成后又保存新草稿），清掉上一次对照的选择
watch(() => store.draft?.savedAt, () => {
  Object.keys(choices).forEach((key) => delete choices[key]);
}, { flush: "sync" });

const counters = computed(() => {
  if (!plan.value) return { draft: 0, official: 0, skip: 0 };
  let draft = 0;
  let official = 0;
  let skip = 0;
  plan.value.rows.forEach((row) => {
    const choice = choices[row.sceneId] ?? store.defaultChoice(row);
    if (choice === "draft") draft += 1;
    else if (choice === "skip") skip += 1;
    else official += 1;
  });
  return { draft, official, skip };
});

const KIND_LABEL: Record<MergeRow["kind"], { label: string; hint: string }> = {
  unchanged: { label: "草稿未动", hint: "直接跟随最新通告" },
  officialOnly: { label: "仅通告改动", hint: "草稿未动，跟随正式通告" },
  draftOnly: { label: "仅草稿改动", hint: "采用草稿" },
  both: { label: "双方都改", hint: "对照确认，默认保留正式通告" },
  added: { label: "新增场次", hint: "基线中不存在" },
  deletedDraft: { label: "草稿删除", hint: "草稿删掉但通告在改，默认保留通告" }
};

function detail(scene: Scene | undefined) {
  if (!scene) return { text: "—（不存在）", missing: true };
  return {
    text: `${scene.day} ${scene.start}-${scene.end} · ${store.locationName(scene.locationId)} · ${scene.status}${scene.locked ? " · 锁定" : ""}`,
    missing: false
  };
}

function choose(row: MergeRow, choice: MergeChoice) {
  // 只有制片确认后才允许用草稿覆盖双方都动过的场次
  if (choice === "draft" && store.role !== "制片") return;
  choices[row.sceneId] = choice;
}

const lastRecord = computed(() => store.mergeRecords[0]);

function commit() {
  const result = store.commitMerge({ ...choices }, store.role);
  if (!result.ok) {
    alert(result.message ?? "合并失败");
  }
}
</script>

<template>
  <section class="page">
    <el-empty v-if="!store.draft" description="当前没有待合并的离线草稿" />
    <template v-else-if="plan">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>草稿合并对照</h2>
            <small class="muted">草稿保存于 {{ dayjs(store.draft.savedAt).format("YYYY-MM-DD HH:mm") }} · <template v-if="store.draft.baselineSeq >= 0">基线序号 {{ store.draft.baselineSeq }}<template v-if="store.draft.baselineVersionName">（{{ store.draft.baselineVersionName }}）</template></template><template v-else>基线缺失</template></small>
          </div>
          <button class="secondary danger" @click="store.discardDraft">放弃草稿</button>
        </div>
        <div v-if="plan.staleReasons.length" class="stale-box">
          <b>⚠ 本次同步需要重新确认，不能自动套用</b>
          <p v-for="(reason, index) in plan.staleReasons" :key="index">{{ reason }}</p>
        </div>
        <div class="merge-summary">
          <span>共 {{ plan.rows.length }} 场</span>
          <span class="tag draft">采用草稿 {{ counters.draft }}</span>
          <span class="tag official">正式通告 {{ counters.official }}</span>
          <span class="tag skip">跳过 {{ counters.skip }}</span>
        </div>
      </section>

      <section class="panel">
        <div class="merge-list">
          <article v-for="row in plan.rows" :key="row.sceneId" class="merge-row" :class="['kind-' + row.kind, { chosen: choices[row.sceneId] === 'draft' }]">
            <header>
              <div>
                <b>{{ row.code }}</b>
                <span class="merge-kind">{{ KIND_LABEL[row.kind].label }}</span>
                <small class="muted">{{ KIND_LABEL[row.kind].hint }}</small>
              </div>
              <small v-if="row.fields.length" class="field-changes">差异字段：{{ row.fields.join("、") }}</small>
            </header>
            <div class="merge-cols">
              <div class="merge-col" :class="{ picked: choices[row.sceneId] === 'official' }">
                <em>正式通告</em>
                <p :class="{ missing: detail(row.official).missing }">{{ detail(row.official).text }}</p>
              </div>
              <div class="merge-col" :class="{ picked: choices[row.sceneId] === 'draft' }">
                <em>离线草稿</em>
                <p :class="{ missing: detail(row.draft).missing }">{{ detail(row.draft).text }}</p>
              </div>
            </div>
            <footer>
              <label v-if="row.official" class="pick"><input type="radio" :name="row.sceneId" :checked="choices[row.sceneId] === 'official'" @change="choose(row, 'official')" /> 保留正式通告</label>
              <label class="pick" :class="{ disabled: store.role !== '制片' }">
                <input type="radio" :name="row.sceneId" :checked="choices[row.sceneId] === 'draft'" :disabled="(!row.draft && row.kind !== 'deletedDraft') || store.role !== '制片'" @change="choose(row, 'draft')" /> {{ row.kind === 'deletedDraft' ? "跟随草稿删除" : "用草稿覆盖" }}
                <small v-if="store.role !== '制片'" class="muted">（需制片确认）</small>
              </label>
              <label v-if="!row.official" class="pick"><input type="radio" :name="row.sceneId" :checked="choices[row.sceneId] === 'skip'" @change="choose(row, 'skip')" /> 跳过不采用</label>
            </footer>
          </article>
        </div>
      </section>

      <section class="panel commit-bar">
        <small class="muted">
          双方都改动的场次默认保留正式通告；切换为「用草稿覆盖」需当前角色为制片。
          <template v-if="plan.staleReasons.length">基线已失效，整次合并必须由制片重新确认后才能提交。</template>
        </small>
        <button class="primary" :disabled="store.role !== '制片'" @click="commit">制片确认并完成合并</button>
      </section>
    </template>

    <section v-if="lastRecord && !store.draft" class="panel">
      <div class="panel-head">
        <div><h2>最近一次合并记录</h2><small class="muted">{{ dayjs(lastRecord.time).format("YYYY-MM-DD HH:mm") }} · 确认人：{{ lastRecord.confirmedBy }}</small></div>
        <RouterLink class="secondary" to="/history">查看全部记录</RouterLink>
      </div>
      <p>来自草稿 <b>{{ lastRecord.fromDraft }}</b> 场 · 采用正式通告 <b>{{ lastRecord.fromOfficial }}</b> 场 · 跳过 <b>{{ lastRecord.skipped }}</b> 场<template v-if="lastRecord.stale"><span class="stale-flag">基线失效，已重新确认</span></template></p>
    </section>
  </section>
</template>
