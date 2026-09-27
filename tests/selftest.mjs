/* 服药提醒 —— 核心逻辑自测（Node 跑，不依赖浏览器）
   做法：从 HTML 里抽出 <script>，用最小 DOM 桩在 vm 里跑起来，
   然后直接调用真实函数验证剂量推算 / 阶梯 / ICS 导出 / 库存。
   用法： node tests/selftest.mjs                                        */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, "..", "服药提醒.html");
const html = fs.readFileSync(HTML, "utf8");
const mm = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if (!mm) { console.error("FAIL: 没找到 <script> 块"); process.exit(1); }
let js = mm[1];

/* ---- 最小 DOM 桩 ---- */
function makeEl(tag) {
  const el = {
    tagName: tag || "div", textContent: "", innerHTML: "", value: "", scrollTop: 0,
    style: {}, files: null, _attrs: {}, _cls: new Set(),
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, dispatchEvent() {},
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    }
  };
  return el;
}
const store = new Map();
const ctx = {
  console,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  },
  document: {
    querySelector: () => makeEl("div"),
    querySelectorAll: () => [],
    addEventListener() {}, createElement: t => makeEl(t),
    body: { appendChild() {}, removeChild() {} }, hidden: false
  },
  window: { addEventListener() {}, scrollTo() {}, open: () => null },
  Notification: undefined, Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL() {} },
  FileReader: class {}, Date, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt
};
ctx.globalThis = ctx;
ctx.self = ctx;

/* 把内部符号暴露出来（顶层 let 不进 globalThis，所以显式导出） */
js += `
;globalThis.__T = {
  get state(){return state;}, set state(v){state=v;},
  defaultState, getDayPlan, slotDose, dailyTotal, patternValue, medActiveOn,
  dayIndexOf, buildICS, countEvents, findMed, setLog, getLog, stockInfo,
  previewDays, addDays, todayStr, patternSummary, courseSummary, doseText, doseNum,
  dayDoseInfo, altCycle, altMemberIndex, altMember, altSummaryText, altRhythmText
};`;

vm.createContext(ctx);
try { vm.runInContext(js, ctx, { filename: "app.js" }); }
catch (e) { console.error("FAIL: 脚本执行出错 →", e.message); process.exit(1); }

const T = ctx.__T;
if (!T) { console.error("FAIL: 未能导出内部符号"); process.exit(1); }

/* ---- 断言 ---- */
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  → 实际: " + extra : "")); }
}
function eq(name, actual, expected) {
  ok(name + "  (期望 " + JSON.stringify(expected) + ")", JSON.stringify(actual) === JSON.stringify(expected), JSON.stringify(actual));
}

const today = T.todayStr();
function addMed(o) {
  const m = Object.assign({
    id: "t" + Math.random().toString(36).slice(2, 7), name: "测试药", strength: "", unit: "片",
    color: "#2f6f5e", startDate: today, durationDays: "", times: ["08:00"],
    doseMode: "perDose", mode: "cycle", cycle: [1],
    step: { start: 1, delta: -0.5, everyDays: 3, min: "", max: "" },
    meal: "", note: "", stock: "", enabled: true
  }, o);
  T.state.meds.push(m);
  return m;
}
function doses(med, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(T.slotDose(med, i));
  return out;
}

console.log("\n=== 1. 用户举的例子：今天 1 片 / 明天半片 / 后天回到 1 片 ===");
T.state.meds = [];
const m1 = addMed({ name: "阿莫西林", cycle: [1, 0.5], times: ["08:00"] });
eq("连续 6 天每次剂量", doses(m1, 6), [1, 0.5, 1, 0.5, 1, 0.5]);
eq("明天(day1)的剂量", T.slotDose(m1, 1), 0.5);
eq("后天(day2)的剂量", T.slotDose(m1, 2), 1);
ok("getDayPlan(今天) 有 1 条", T.getDayPlan(today).length === 1, T.getDayPlan(today).length);
ok("getDayPlan(明天) 剂量 = 0.5", T.getDayPlan(T.addDays(today, 1))[0].dose === 0.5);

console.log("\n=== 2. 每天同量 / 吃5停2 / 多时段 ===");
T.state.meds = [];
const m2 = addMed({ name: "药B", cycle: [1], times: ["08:00"] });
eq("每天同量", doses(m2, 3), [1, 1, 1]);
T.state.meds = [];
const m3 = addMed({ name: "药C", cycle: [1, 1, 1, 1, 1, 0, 0], times: ["08:00"] });
eq("吃5停2（7天）", doses(m3, 7), [1, 1, 1, 1, 1, 0, 0]);
T.state.meds = [];
const m4 = addMed({ name: "药D", cycle: [1], times: ["08:00", "20:00"] });
eq("每天2次·每次剂量模式 → 每次1片", doses(m4, 2), [1, 1]);
eq("每天2次·每日总量", T.dailyTotal(m4, 0), 2);
T.state.meds = [];
const m5 = addMed({ name: "药E", cycle: [2], times: ["08:00", "20:00"], doseMode: "perDay" });
eq("每日总量2片分2次 → 每次1片", doses(m5, 2), [1, 1]);
eq("每日总量仍为 2", T.dailyTotal(m5, 0), 2);

console.log("\n=== 3. 阶梯模式（逐渐减量）===");
T.state.meds = [];
const m6 = addMed({ name: "激素", mode: "step", step: { start: 3, delta: -0.5, everyDays: 3, min: 0.5, max: "" }, times: ["08:00"] });
eq("起始3、每3天减0.5（12天）", doses(m6, 12), [3, 3, 3, 2.5, 2.5, 2.5, 2, 2, 2, 1.5, 1.5, 1.5]);
T.state.meds = [];
const m7 = addMed({ name: "下限测试", mode: "step", step: { start: 1, delta: -0.5, everyDays: 1, min: 0.5, max: "" } });
eq("减到下限后不再降", doses(m7, 5), [1, 0.5, 0.5, 0.5, 0.5]);

console.log("\n=== 4. 疗程天数与开始日期 ===");
T.state.meds = [];
const m8 = addMed({ name: "疗程药", cycle: [1], durationDays: 3 });
eq("3天疗程的活跃判定(day0..3)", [0, 1, 2, 3].map(d => T.medActiveOn(m8, d)), [true, true, true, false]);
eq("疗程第4天无安排", T.getDayPlan(T.addDays(today, 3)).length, 0);
T.state.meds = [];
const m9 = addMed({ name: "未来药", startDate: T.addDays(today, 2), cycle: [1] });
eq("未开始 → 今天无安排", T.getDayPlan(today).length, 0);
eq("开始当天有安排", T.getDayPlan(T.addDays(today, 2)).length, 1);

console.log("\n=== 5. 暂停 / 打卡 / 库存 ===");
T.state.meds = [];
const m10 = addMed({ name: "库存药", cycle: [1], times: ["08:00"], stock: 10 });
eq("库存10 → 剩余10", T.stockInfo(m10).remain, 10);
T.setLog(today, m10.id, "08:00", "taken");
eq("打卡1次后已用", T.stockInfo(m10).used, 1);
eq("打卡1次后剩余", T.stockInfo(m10).remain, 9);
eq("还能吃几天", T.stockInfo(m10).days, 9);
ok("打卡记录读回", T.getLog(today, m10.id, "08:00").s === "taken");
T.setLog(today, m10.id, "08:00", null);
eq("取消打卡后剩余恢复", T.stockInfo(m10).remain, 10);
m10.enabled = false;
eq("暂停后无安排", T.getDayPlan(today).length, 0);
m10.enabled = true;

console.log("\n=== 6. 日历(.ics)导出 ===");
T.state.meds = [];
const m11 = addMed({ name: "导出药", cycle: [1, 0.5], times: ["08:00", "20:00"] });
T.state.settings.exportDays = 3;
T.state.settings.alarmMin = [15, 0];
const ics = T.buildICS(3);
ok("含 BEGIN:VCALENDAR", ics.indexOf("BEGIN:VCALENDAR") === 0);
ok("含 END:VCALENDAR", ics.trim().endsWith("END:VCALENDAR"));
eq("3天×2次 = 6 条 VEVENT", (ics.match(/BEGIN:VEVENT/g) || []).length, 6);
eq("每条 2 个闹钟 → 12 个 VALARM", (ics.match(/BEGIN:VALARM/g) || []).length, 12);
ok("含提前15分触发器 TRIGGER:-PT15M", ics.includes("TRIGGER:-PT15M"));
ok("含准点触发器 TRIGGER:PT0M", ics.includes("TRIGGER:PT0M"));
ok("用 CRLF 换行", ics.includes("\r\n"));
ok("DTSTART 为本地浮动时间(无Z)", /DTSTART:\d{8}T\d{6}\r\n/.test(ics));
ok("标题含药名与剂量", ics.includes("SUMMARY:") && ics.includes("导出药"));
ok("含 0.5 剂量的事件", /SUMMARY:[^\r\n]*0\.5/.test(ics));
ok("无未转义的行内裸逗号破坏结构", !/SUMMARY:[^\r\n]*,[^\r\n]*\r\nDTSTART/.test(ics));
eq("countEvents(3) = 6", T.countEvents(3), 6);
ok("每行 ≤ 75 字符（iCalendar 折行规则）", ics.split("\r\n").every(l => l.length <= 75),
   ics.split("\r\n").filter(l => l.length > 75).slice(0, 1).join(""));

console.log("\n=== 7. 摘要文案 ===");
ok("循环摘要含序列", T.patternSummary(m11).includes("1 / 0.5"), T.patternSummary(m11));
ok("疗程摘要含长期", T.courseSummary(m1).includes("长期"), T.courseSummary(m1));
eq("0.5 片的友好显示", T.doseText(0.5, "片", true), "0.5 片（半片）");
eq("1 片的显示", T.doseText(1, "片", true), "1 片");

console.log("\n=== 9. 两种药交替（本次新增）===");
function altMed(names, doses, days, startMember, times) {
  return addMed({
    name: "", mode: "alt", unit: "片", times: times || ["08:00"],
    alt: {
      members: names.map((n, i) => ({ name: n, dose: doses[i], unit: "片" })),
      segments: names.map((n, i) => ({ m: i, days: days[i] })),
      startMember: startMember
    }
  });
}
function altNames(med, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(T.dayDoseInfo(med, i).name);
  return out;
}

T.state.meds = [];
const a1 = altMed(["甲药", "乙药"], [1, 1], [1, 1], 0);
eq("甲1天/乙1天，从甲开始 → 药名", altNames(a1, 6), ["甲药", "乙药", "甲药", "乙药", "甲药", "乙药"]);
eq("甲1天/乙1天，从甲开始 → 剂量", doses(a1, 4), [1, 1, 1, 1]);

T.state.meds = [];
const a2 = altMed(["甲药", "乙药"], [1, 1], [1, 1], 1);
eq("★初始值=乙 → 今天该吃哪个", altNames(a2, 4), ["乙药", "甲药", "乙药", "甲药"]);

T.state.meds = [];
const a3 = altMed(["甲药", "乙药"], [1, 0.5], [3, 3], 0);
eq("甲3天/乙3天，从甲开始", altNames(a3, 8), ["甲药", "甲药", "甲药", "乙药", "乙药", "乙药", "甲药", "甲药"]);
eq("甲3天/乙3天 → 剂量(乙是半片)", doses(a3, 6), [1, 1, 1, 0.5, 0.5, 0.5]);

T.state.meds = [];
const a4 = altMed(["甲药", "乙药"], [1, 0.5], [3, 3], 1);
eq("★甲3天/乙3天，初始值=乙", altNames(a4, 7), ["乙药", "乙药", "乙药", "甲药", "甲药", "甲药", "乙药"]);

T.state.meds = [];
const a5 = altMed(["甲药", "乙药"], [1, 1], [2, 1], 0);
eq("甲2天/乙1天 → 节奏", altNames(a5, 6), ["甲药", "甲药", "乙药", "甲药", "甲药", "乙药"]);

T.state.meds = [];
const a6 = altMed(["甲药", "乙药", "丙药"], [1, 2, 0.5], [1, 1, 1], 2);
eq("三种药轮换，初始值=丙", altNames(a6, 6), ["丙药", "甲药", "乙药", "丙药", "甲药", "乙药"]);
eq("三种药剂量各自独立", doses(a6, 3), [0.5, 1, 2]);

T.state.meds = [];
const a7 = altMed(["甲药", "乙药"], [1, 1], [1, 1], 0, ["08:00", "20:00"]);
eq("交替+每天2次 → 每天2条", T.getDayPlan(today).length, 2);
eq("交替+每天2次 → 每日总量", T.dailyTotal(a7, 0), 2);
ok("getDayPlan 带出当天药名", T.getDayPlan(today)[0].name === "甲药", T.getDayPlan(today)[0].name);
ok("明天 getDayPlan 药名已切换", T.getDayPlan(T.addDays(today, 1))[0].name === "乙药");
eq("交替方案不做库存推算", T.stockInfo(a7), null);
ok("摘要含两种药名", T.altSummaryText(a1).includes("甲药") && T.altSummaryText(a1).includes("乙药"), T.altSummaryText(a1));
ok("节奏摘要正确", T.altRhythmText(a3) === "甲药 3 天 → 乙药 3 天", T.altRhythmText(a3));
ok("patternSummary 走交替分支", T.patternSummary(a1).indexOf("交替") === 0, T.patternSummary(a1));

T.state.meds = [a1];                       /* 换成每天 1 次的交替方案再测导出 */
T.state.settings.exportDays = 4;
const ics2 = T.buildICS(4);
ok("ICS 标题含当天药名(甲药)", ics2.includes("甲药"), "");
ok("ICS 标题含隔天药名(乙药)", ics2.includes("乙药"));
ok("ICS 描述含交替方案", ics2.includes("交替方案"));
eq("ICS 事件数 4天×1次 = 4", (ics2.match(/BEGIN:VEVENT/g) || []).length, 4);
T.state.meds = [a7];
const ics3 = T.buildICS(3);
eq("交替+每天2次 → ICS 3天 = 6 条", (ics3.match(/BEGIN:VEVENT/g) || []).length, 6);

console.log("\n=== 8. 数据持久化（localStorage 往返）===");
T.state.meds = [m11];
store.clear();
ctx.localStorage.setItem("med_reminder_v1", JSON.stringify(T.state));
const raw = JSON.parse(ctx.localStorage.getItem("med_reminder_v1"));
ok("已写入 localStorage", raw.meds.length === 1 && raw.meds[0].name === "导出药");

console.log("\n========================================");
console.log("  通过 " + pass + " 项，失败 " + fail + " 项");
console.log("========================================\n");
process.exit(fail ? 1 : 0);
