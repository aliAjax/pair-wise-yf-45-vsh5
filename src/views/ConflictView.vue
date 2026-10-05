<script setup lang="ts">
import { useScheduleStore } from "../stores/schedule";
const store = useScheduleStore();
function sceneName(id: string) {
  const scene = store.scenes.find((item) => item.id === id);
  return scene ? `${scene.code} ${scene.title}` : id;
}
</script>
<template>
  <section class="page">
    <section class="panel">
      <div class="panel-head"><div><h2>资源冲突中心</h2><small class="muted">系统按日期和时间段检查演员、场地、器材与转场间隔；豁免随合并结果重算，依据失效需重新确认</small></div><span class="status">{{ store.conflicts.length }} 项待处理</span></div>
      <article v-for="item in store.conflicts" :key="item.id" class="conflict" :class="{ stale: item.exemptionStale }">
        <span class="seal">{{ item.severity }}</span>
        <div>
          <b>{{ item.type }}<small v-if="item.exemptionStale" class="stale-flag">原豁免依据已变化，需重新确认</small></b>
          <p>{{ item.message }}</p>
          <small>{{ item.sceneIds.map(sceneName).join(" ↔ ") }}</small>
        </div>
        <div class="actions">
          <button v-if="item.exemptionStale" class="primary" :disabled="store.role === '场记'" @click="store.reconfirmExemption(item.id)">重新确认豁免</button>
          <button v-else class="secondary" :disabled="store.role === '场记'" @click="store.exempt(item.id)">负责人豁免</button>
        </div>
      </article>
      <el-empty v-if="!store.conflicts.length" description="当前没有未处理冲突" />
    </section>
  </section>
</template>
