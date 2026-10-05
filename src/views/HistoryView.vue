<script setup lang="ts">
import dayjs from "dayjs";
import { useScheduleStore } from "../stores/schedule";
const store = useScheduleStore();
</script>
<template>
  <section class="page">
    <section class="panel">
      <div class="panel-head"><div><h2>离线合并记录</h2><small class="muted">每场标注来自草稿还是正式通告，可追溯合并结果</small></div><span class="status">{{ store.mergeRecords.length }} 次</span></div>
      <el-empty v-if="!store.mergeRecords.length" description="尚未进行离线合并" />
      <article v-for="rec in store.mergeRecords" :key="rec.id" class="merge-record">
        <div class="merge-record-head">
          <b>{{ dayjs(rec.time).format("YYYY-MM-DD HH:mm:ss") }}</b>
          <small class="muted">草稿保存于 {{ dayjs(rec.draftSavedAt).format("MM-DD HH:mm") }} · 操作人 {{ rec.operator }}</small>
          <span class="merge-summary">草稿 {{ rec.summary.draft }} 场 · 正式通告 {{ rec.summary.official }} 场 · 草稿覆盖 {{ rec.summary.overrides }} 场</span>
        </div>
        <div v-if="rec.baselineMissing || rec.officialReverted" class="merge-warn">
          <span v-if="rec.baselineMissing">基线缺失，已重新确认 · </span>
          <span v-if="rec.officialReverted">正式通告回退，已重新确认</span>
        </div>
        <div class="merge-chips">
          <span v-for="item in rec.items" :key="item.sceneId" class="merge-chip" :class="item.source">
            <em>{{ item.source === "draft" ? "草稿" : "正式" }}</em>
            {{ item.code }} {{ item.title }}
            <small>{{ item.reason }}</small>
          </span>
        </div>
      </article>
    </section>

    <div class="grid-2">
      <section class="panel">
        <div class="panel-head"><div><h2>版本快照</h2><small class="muted">恢复会覆盖当前通告，但保留恢复记录</small></div><button class="primary" :disabled="store.role === '场记'" @click="store.snapshot()">创建版本</button></div>
        <el-empty v-if="!store.versions.length" description="尚未创建版本" />
        <article v-for="item in store.versions" :key="item.id" class="draft-banner" style="margin-bottom:10px">
          <div><b>{{ item.name }}</b><br><small>{{ dayjs(item.time).format("YYYY-MM-DD HH:mm:ss") }} · {{ item.scenes.length }} 场</small></div>
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
    </div>
  </section>
</template>
