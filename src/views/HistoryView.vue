<script setup lang="ts">
import dayjs from "dayjs";
import { ref } from "vue";
import { useScheduleStore } from "../stores/schedule";
const store = useScheduleStore();
const expanded = ref<string | null>(null);
const SOURCE_LABEL = { draft: "来自草稿", official: "采用正式通告", skipped: "跳过未采用" } as const;
const KIND_LABEL: Record<string, string> = {
  unchanged: "草稿未动",
  officialOnly: "仅通告改动",
  draftOnly: "仅草稿改动",
  both: "双方都改",
  added: "新增场次",
  deletedDraft: "草稿删除"
};
function toggle(id: string) {
  expanded.value = expanded.value === id ? null : id;
}
</script>
<template>
  <section class="page grid-2">
    <section class="panel">
      <div class="panel-head"><div><h2>版本快照</h2><small class="muted">恢复会覆盖当前通告（序号回退），之后的草稿合并将要求重新确认；恢复记录会保留</small></div><button class="primary" :disabled="store.role === '场记'" @click="store.snapshot()">创建版本</button></div>
      <el-empty v-if="!store.versions.length" description="尚未创建版本" />
      <article v-for="item in store.versions" :key="item.id" class="draft-banner" style="margin-bottom:10px">
        <div><b>{{ item.name }}</b><br><small>{{ dayjs(item.time).format("YYYY-MM-DD HH:mm:ss") }} · 序号 {{ item.seq }} · {{ item.scenes.length }} 场</small></div>
        <button class="secondary" :disabled="store.role !== '制片'" @click="store.restore(item.id)">恢复</button>
      </article>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>操作历史</h2></div>
      <div class="history">
        <el-empty v-if="!store.history.length" description="暂无操作" />
        <div v-for="item in store.history" :key="item.id" class="history-row"><span class="muted">{{ dayjs(item.time).format("MM-DD HH:mm:ss") }}</span><b>{{ item.action }}</b><span>{{ item.detail }}</span></div>
      </div>
    </section>
    <section class="panel" style="grid-column:1/-1">
      <div class="panel-head"><div><h2>合并记录</h2><small class="muted">每次草稿合并的留档，可逐场查看最终来自草稿还是正式通告</small></div></div>
      <el-empty v-if="!store.mergeRecords.length" description="暂无合并记录" />
      <article v-for="record in store.mergeRecords" :key="record.id" class="merge-record">
        <header @click="toggle(record.id)">
          <div>
            <b>{{ dayjs(record.time).format("YYYY-MM-DD HH:mm") }} 合并</b>
            <small class="muted">草稿保存于 {{ dayjs(record.draftSavedAt).format("MM-DD HH:mm") }} · 基线序号 {{ record.baselineSeq }}<template v-if="record.baselineVersionName">（{{ record.baselineVersionName }}）</template> · 确认人 {{ record.confirmedBy }}</small>
          </div>
          <div class="merge-record-totals">
            <span class="tag draft">草稿 {{ record.fromDraft }}</span>
            <span class="tag official">通告 {{ record.fromOfficial }}</span>
            <span class="tag skip">跳过 {{ record.skipped }}</span>
            <span v-if="record.stale" class="stale-flag">基线失效已重认</span>
            <small class="muted">{{ expanded === record.id ? "收起 ▲" : "展开 ▼" }}</small>
          </div>
        </header>
        <div v-if="expanded === record.id" class="merge-record-items">
          <div v-for="item in record.items" :key="item.sceneId" class="merge-record-item">
            <span>{{ item.code }} {{ item.title }}</span>
            <small class="muted">{{ KIND_LABEL[item.kind] ?? item.kind }}</small>
            <em :class="item.source">{{ SOURCE_LABEL[item.source] }}</em>
          </div>
        </div>
      </article>
    </section>
  </section>
</template>
