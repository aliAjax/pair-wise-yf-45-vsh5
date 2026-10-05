import { createRouter, createWebHashHistory } from "vue-router";
import ScheduleView from "../views/ScheduleView.vue";
import ConflictView from "../views/ConflictView.vue";
import HistoryView from "../views/HistoryView.vue";
import MergeView from "../views/MergeView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "schedule", component: ScheduleView },
    { path: "/merge", name: "merge", component: MergeView },
    { path: "/conflicts", name: "conflicts", component: ConflictView },
    { path: "/history", name: "history", component: HistoryView }
  ]
});
