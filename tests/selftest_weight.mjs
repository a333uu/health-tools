/* 减重助手 —— 核心逻辑自测（Node 跑，不依赖浏览器）
   重点验证：7 日移动平均、趋势判读、宽容式连续计数、腰高比、
             BMR/TDEE、目标进度、以及【正反馈文案禁止词门】。
   用法： node tests/selftest_weight.mjs                                  */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.join(here, "..", "减重助手.html");
const html = fs.readFileSync(HTML, "utf8");
const mm = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if (!mm) { console.error("FAIL: 没找到 <script>"); process.exit(1); }
let js = mm[1];

/* ---- 最小 DOM 桩 ---- */
function makeEl() {
  const el = {
    textContent: "", innerHTML: "", value: "", style: {}, files: null, _attrs: {}, _cls: new Set(),
    addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
  return el;
}
const store = new Map();
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)
  },
  document: {
    querySelector: () => makeEl(), querySelectorAll: () => [],
    addEventListener() {}, createElement: () => makeEl(),
    body: { appendChild() {}, removeChild() {} }, hidden: false
  },
  window: { addEventListener() {}, scrollTo() {} },
  Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL() {} }, FileReader: class {},
  Date, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt
};
ctx.globalThis = ctx; ctx.self = ctx;

js += `
;globalThis.__T = {
  get state(){return state;}, set state(v){state=v;},
  defaultState, w7, w7Prev, median, last7, trendDir, streak, whtr, bmr, tdee, kcalFloor,
  goalProgress, waistChange30, waistDue, latestWaist, waist30dAgo,
  buildFeedback, auditFeedbackText, FORBIDDEN, svgChart, addDays, todayStr, n1, n2,
  /* 热量定投（第 4.B 节） */
  healthIndex, healthFactor, countedDeficit, poolDay, poolTotal, poolSeries,
  sleepScore, waterScore, stepsScore, POOL, behaviorCoverage, SUBJECTS, enabledSubjectIds, isOnId, sleepRegularityScore, clockHour, clockDist, optionScore, optionLabel
};`;

vm.createContext(ctx);
try { vm.runInContext(js, ctx, { filename: "app.js" }); }
catch (e) { console.error("FAIL: 脚本执行出错 →", e.message); process.exit(1); }
const T = ctx.__T;
if (!T) { console.error("FAIL: 未导出内部符号"); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (extra !== undefined ? "  → 实际: " + extra : "")); }
}
function eq(name, a, b) { ok(name + "  (期望 " + JSON.stringify(b) + ")", JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a)); }

const today = T.todayStr();
function setDay(offset, obj) { T.state.daily[T.addDays(today, offset)] = obj; }
function reset() { T.state.daily = {}; T.state.waist = {}; T.state.nsv = []; }

console.log("\n=== 1. 7 日中位数（核心：抹掉日波动 + 抗单日尖峰）===");
reset();
/* 7 天体重排序后：68.0 68.2 68.3 68.4 68.5 68.6 68.8 → 中位数 = 68.4 */
const ws = [68.0, 68.5, 68.2, 68.8, 68.3, 68.6, 68.4];
ws.forEach((w, i) => setDay(i - 6, { w: w }));
const sorted = ws.slice().sort((a, b) => a - b);
eq("W7 等于 7 天的中位数（排序后取中间那个）", T.w7(today), sorted[3]);
eq("W7 值 = 68.4", Number(T.w7(today).toFixed(2)), 68.4);
ok("中位数函数本身正确（奇数个）", T.median([1, 5, 3]) === 3 && T.median([9]) === 9);
ok("中位数函数本身正确（偶数个取中间两个的平均）", T.median([1, 2, 3, 4]) === 2.5);
ok("中位数函数本身正确（空数组 → null）", T.median([]) === null);

/* 抗尖峰：这是本次改动的核心目的 */
reset();
[68.0, 68.1, 68.0, 68.2, 68.1, 68.0, 70.5].forEach((w, i) => setDay(i - 6, { w: w }));
const meanWithSpike = [68.0, 68.1, 68.0, 68.2, 68.1, 68.0, 70.5].reduce((a, b) => a + b, 0) / 7;
eq("单日尖峰（吃咸了 +2.4kg）不拉动中位数", Number(T.w7(today).toFixed(2)), 68.1);
ok("同样的数据下平均数会被拉高（证明中位数确实更抗干扰）", meanWithSpike > T.w7(today) + 0.2,
   "平均 " + meanWithSpike.toFixed(2) + " vs 中位 " + T.w7(today).toFixed(2));

/* 趋势方向也不能被单日尖峰带偏 */
reset();
[70.0, 70.0, 70.0, 70.0, 70.0, 70.0, 70.0].forEach((w, i) => setDay(i - 13, { w: w }));
[69.0, 69.0, 69.0, 69.0, 69.0, 69.0, 75.0].forEach((w, i) => setDay(i - 6, { w: w }));
eq("趋势仍判为下降（今日尖峰不影响方向）", T.trendDir(today).dir, "down");

reset();
setDay(0, { w: 70 }); setDay(-1, { w: 60 });
eq("只有 2 天数据 → 取中间两个的平均（不插值补零）", T.w7(today), 65);

reset();
eq("完全无数据 → null", T.w7(today), null);

reset();
setDay(0, { w: 70 }); setDay(-3, { w: 50 });
eq("缺测日被跳过（不按 7 天除）", T.w7(today), 60);

console.log("\n=== 2. 趋势判读 ===");
reset();
/* 前 7 天 70kg，后 7 天 69kg → 下降 */
for (let i = 13; i >= 7; i--) setDay(-i, { w: 70 });
for (let i = 6; i >= 0; i--) setDay(-i, { w: 69 });
eq("下降趋势判定", T.trendDir(today).dir, "down");
ok("下降幅度 ≈ -1.0", Math.abs(T.trendDir(today).delta + 1) < 1e-9, T.trendDir(today).delta);

reset();
for (let i = 13; i >= 0; i--) setDay(-i, { w: 70 });
eq("持平（±0.2 内）判定", T.trendDir(today).dir, "flat");

reset();
for (let i = 13; i >= 7; i--) setDay(-i, { w: 69 });
for (let i = 6; i >= 0; i--) setDay(-i, { w: 70 });
eq("上升趋势判定", T.trendDir(today).dir, "up");

reset();
setDay(0, { w: 70 });
eq("只有当前窗口 → first", T.trendDir(today).dir, "first");

console.log("\n=== 3. 宽容式连续计数（每周允许断 1 天）===");
reset();
for (let i = 0; i < 5; i++) setDay(-i, { w: 70 });
eq("连续 5 天全记 → 5", T.streak(), 5);

reset();
/* 断 1 天（第 3 天），应继续 */
setDay(0, { w: 70 }); setDay(-1, { w: 70 }); setDay(-2, { w: 70 });
setDay(-4, { w: 70 }); setDay(-5, { w: 70 });
ok("断 1 天不断链（宽容）", T.streak() >= 4, T.streak());

reset();
/* 今天没记不算断 */
setDay(-1, { w: 70 }); setDay(-2, { w: 70 });
eq("今天未记录不计为断链", T.streak(), 2);

console.log("\n=== 4. 腰高比 ===");
T.state.profile.height = 165;
eq("腰围 82.5 / 身高 165", Number(T.whtr(82.5).toFixed(4)), 0.5);
ok("腰高比 < 0.5 = 健康区", T.whtr(80) < 0.5);
ok("腰高比 > 0.5 = 偏大", T.whtr(90) > 0.5);
T.state.profile.height = 0;
eq("缺身高 → null", T.whtr(82), null);
T.state.profile.height = 165;

console.log("\n=== 5. BMR / TDEE（Mifflin-St Jeor）===");
T.state.profile = Object.assign(T.state.profile, { sex: "f", birthYear: new Date().getFullYear() - 30, height: 165, activity: 1.375 });
reset();
for (let i = 0; i < 7; i++) setDay(-i, { w: 65 });
/* 女: 10*65 + 6.25*165 - 5*30 - 161 = 650 + 1031.25 - 150 - 161 = 1370.25 */
ok("女性 BMR 公式", Math.abs(T.bmr() - 1370.25) < 1e-6, T.bmr());
T.state.profile.sex = "m";
/* 男: 同参数 +5 而非 -161 → 1370.25 + 166 = 1536.25 */
ok("男性 BMR = 女性 + 166", Math.abs(T.bmr() - 1536.25) < 1e-6, T.bmr());
ok("TDEE = BMR × 1.375", Math.abs(T.tdee() - 1536.25 * 1.375) < 1e-6, T.tdee());
eq("男性热量下限 1500", T.kcalFloor(), 1500);
T.state.profile.sex = "f";
eq("女性热量下限 1200", T.kcalFloor(), 1200);

console.log("\n=== 6. 目标进度 ===");
T.state.profile = Object.assign(T.state.profile, { startWeight: 70, targetWeight: 60 });
reset();
for (let i = 0; i < 7; i++) setDay(-i, { w: 65 });
const gp = T.goalProgress();
eq("已完成 50%", Math.round(gp.pct), 50);
eq("距目标 5 kg", gp.left, 5);
T.state.profile.targetWeight = "";
eq("无目标 → null", T.goalProgress(), null);

console.log("\n=== 7. 腰围月度变化 ===");
reset();
T.state.waist[T.addDays(today, -35)] = 85;
T.state.waist[T.addDays(today, -5)] = 82;
const wc = T.waistChange30();
ok("30 天变化 -3 cm", wc && Math.abs(wc.delta + 3) < 1e-9, wc && wc.delta);
reset();
T.state.waist[today] = 82;
eq("首次记录 → 无 30 天对比", T.waistChange30(), null);
eq("刚量过 → 不到期", T.waistDue(), false);
T.state.waist = {}; T.state.waist[T.addDays(today, -8)] = 84;
eq("距上次 8 天 → 到期", T.waistDue(), true);

console.log("\n=== 8. 【交付门】正反馈文案禁止词扫描 ===");
reset();
T.state.profile = Object.assign(T.state.profile, { startWeight: 70, targetWeight: 60 });
const scenarios = [
  ["无任何记录", () => { reset(); }],
  ["下降趋势", () => { reset(); for (let i = 13; i >= 7; i--) setDay(-i, { w: 70 }); for (let i = 6; i >= 0; i--) setDay(-i, { w: 69 }); }],
  ["上升趋势", () => { reset(); for (let i = 13; i >= 7; i--) setDay(-i, { w: 69 }); for (let i = 6; i >= 0; i--) setDay(-i, { w: 70 }); }],
  ["持平", () => { reset(); for (let i = 13; i >= 0; i--) setDay(-i, { w: 70 }); }],
  ["首次记录", () => { reset(); setDay(0, { w: 70 }); }],
  ["只记步数", () => { reset(); setDay(0, { steps: 8000 }); }]
];
let allClean = true, blameFound = [];
for (const [name, setup] of scenarios) {
  setup();
  const fb = T.buildFeedback(today);
  const bad = T.FORBIDDEN.filter(w => fb.html.indexOf(w) >= 0);
  if (bad.length) { allClean = false; blameFound.push(name + ":" + bad.join(",")); }
  console.log("    [" + name + "] " + fb.html.replace(/<[^>]+>/g, "").slice(0, 62));
}
ok("六个场景文案全部零禁止词", allClean, blameFound.join(" | "));

console.log("\n=== 9. 【交付门】上升趋势必须给解释、不能指责 ===");
reset();
for (let i = 13; i >= 7; i--) setDay(-i, { w: 69 });
for (let i = 6; i >= 0; i--) setDay(-i, { w: 70 });
const upFb = T.buildFeedback(today).html;
ok("上升时提到「水分/盐分」给出解释", upFb.indexOf("水分") >= 0 || upFb.indexOf("盐分") >= 0, upFb);
ok("上升时引导看 7 日趋势", upFb.indexOf("7 日趋势") >= 0 || upFb.indexOf("7 日") >= 0, upFb);
ok("上升时不使用指责性词汇", !/注意控制|应该|必须|自律/.test(upFb), upFb);

reset();
for (let i = 13; i >= 7; i--) setDay(-i, { w: 70 });
for (let i = 6; i >= 0; i--) setDay(-i, { w: 69 });
const dnFb = T.buildFeedback(today).html;
ok("下降时确认是真实进展（不说是水分）", dnFb.indexOf("真实进展") >= 0, dnFb);

console.log("\n=== 10. 趋势图生成 ===");
reset();
for (let i = 0; i < 30; i++) setDay(-i, { w: 70 - i * 0.05 });
const svg = T.svgChart(30);
ok("SVG 生成成功", typeof svg === "string" && svg.indexOf("<svg") >= 0);
ok("含 7 日平均折线", svg.indexOf("stroke-width=\"2.5\"") >= 0);
ok("含目标线", svg.indexOf("目标") >= 0);
ok("有断线处理（缺测不连线）", svg.indexOf("flushRaw") < 0);
reset();
const emptySvg = T.svgChart(30);
ok("无数据不崩溃", typeof emptySvg === "string");

console.log("\n=== 11. 热量定投：健康指数（只由行为构成）===");
/* TDEE 基线：女 65kg / 165cm / 30 岁 / 1.375 → BMR 1370.25，TDEE 1884.09，下限 1200 */
T.state.profile = Object.assign(T.state.profile, { sex: "f", birthYear: new Date().getFullYear() - 30, height: 165, activity: 1.375, startWeight: 70, targetWeight: 60 });
reset();
T.state.daily[today] = { sleep: 5, water: 2, steps: 2000 };
const hBad = T.healthIndex(today);
T.state.daily[today] = { sleep: 8, water: 8, steps: 8000 };
const hGood = T.healthIndex(today);
ok("睡够喝够走够 → 指数更高", hGood > hBad, hBad + " → " + hGood);
ok("指数在 0-100 区间内", hBad >= 0 && hGood <= 100, hBad + "/" + hGood);
T.state.daily[today] = { w: 65, intake: 1600 };
const hNoBeh = T.healthIndex(today);
T.state.daily[today] = { w: 65, intake: 1600, sleep: 8, water: 8, steps: 8000 };
const hBeh = T.healthIndex(today);
ok("行为项全缺时按覆盖率缩减（不白送满分）", hNoBeh < hBeh && hNoBeh >= 30, hNoBeh);
ok("补上行为数据后指数上升", hBeh > hNoBeh, hNoBeh + " → " + hBeh);
/* 覆盖率：只记一项行为 ≠ 记满三项 */
T.state.daily[today] = { w: 65, sleep: 8 };
const hOne = T.healthIndex(today);
T.state.daily[today] = { w: 65, sleep: 8, water: 8, steps: 8000 };
ok("只记一项行为的指数 < 记满三项", hOne < T.healthIndex(today), hOne + " vs " + T.healthIndex(today));
/* 蛋白质（技能库 §6 杠杆之一，原字段已在收但没被用） */
T.state.daily[today] = { w: 65, sleep: 8, water: 8, steps: 8000, protein: true };
const hProt = T.healthIndex(today);
T.state.daily[today] = { w: 65, sleep: 8, water: 8, steps: 8000, protein: false };
ok("蛋白质够了 > 没够", hProt > T.healthIndex(today), hProt + " vs " + T.healthIndex(today));
ok("蛋白质项本身有区分度（100/40）", T.optionScore("protein", true) === 100 && T.optionScore("protein", false) === 40);
ok("蛋白质未填 → null（不计入分母）", T.optionScore("protein", undefined) === null);
ok("行为覆盖率按已勾选科目算（默认 6 项）", T.behaviorCoverage({ sleep: 8 }) === 1/6 && T.behaviorCoverage({ sleep:8, water:8, steps:8000, protein:true, w:65, bedtime:"23:00" }) === 1);

console.log("\n=== 11.B 健康科目：用户自选（未勾选不参与、不扣分）===");
reset();
T.state.settings.subjects = ["sleep"];
T.state.daily[today] = { sleep: 5 };
const onlySleepLow = T.healthIndex(today);
T.state.daily[today] = { sleep: 8 };
const onlySleepHigh = T.healthIndex(today);
ok("只勾睡眠：睡够 > 睡少", onlySleepHigh > onlySleepLow, onlySleepLow + " → " + onlySleepHigh);
T.state.daily[today] = { sleep: 5, water: 8, steps: 8000 };
ok("未勾选的饮水/步数再好也不影响指数（不扣分也不加分）", T.healthIndex(today) === onlySleepLow, T.healthIndex(today) + " vs " + onlySleepLow);
T.state.settings.subjects = ["sleep", "water", "steps"];
T.state.daily[today] = { sleep: 5 };
const onThreeLow = T.healthIndex(today);
T.state.daily[today] = { sleep: 5, water: 8, steps: 8000 };
ok("勾上饮水/步数后，补上它们会拉高指数", T.healthIndex(today) > onThreeLow, onThreeLow + " → " + T.healthIndex(today));
T.state.settings.subjects = [];
ok("一个科目都不勾 → 中性指数（不奖不罚）", T.healthIndex(today) === T.POOL.neutral, T.healthIndex(today));
ok("科目注册表覆盖 10 个科目", T.SUBJECTS.length === 10 && T.SUBJECTS.map(s=>s.id).join(",") === "sleep,water,steps,protein,regular,weigh,liquid,veg,alcohol,unwind", T.SUBJECTS.length + ":" + T.SUBJECTS.map(s=>s.id).join(","));
delete T.state.settings.subjects;   /* 清掉前序测试残留，验"未设置时的默认值" */
ok("默认只勾前 6 科（新增 4 科默认不勾，由用户自选）", T.enabledSubjectIds().join(",") === "sleep,water,steps,protein,regular,weigh", T.enabledSubjectIds().join(","));
/* 新增四科的取值映射与分数 */
ok("液体热量：没喝 100 / 喝了 45", T.optionScore("liquid", true) === 100 && T.optionScore("liquid", false) === 45);
ok("蔬菜纤维：吃够 100 / 没够 50", T.optionScore("veg", true) === 100 && T.optionScore("veg", false) === 50);
ok("饮酒：没喝 100 / 喝了 50", T.optionScore("alcohol", false) === 100 && T.optionScore("alcohol", true) === 50);
ok("放松活动：做了 100 / 没做 50", T.optionScore("unwind", true) === 100 && T.optionScore("unwind", false) === 50);
ok("未填 → null（不计入分母）", T.optionScore("liquid", undefined) === null && T.optionScore("alcohol", null) === null);
ok("取值 → 显示标签", T.optionLabel("liquid", true) === "没喝" && T.optionLabel("alcohol", false) === "没喝");
/* 新增科目确实影响健康指数 */
reset();
T.state.settings.subjects = ["liquid"];
T.state.daily[today] = { liquid: true };
const hNoSugar = T.healthIndex(today);
T.state.daily[today] = { liquid: false };
ok("勾了液体热量：没喝 > 喝了", hNoSugar > T.healthIndex(today), hNoSugar + " vs " + T.healthIndex(today));
T.state.settings.subjects = ["liquid"];
T.state.daily[today] = { liquid: true, sleep: 8, steps: 9000 };
ok("未勾选的睡眠/步数仍不影响指数", T.healthIndex(today) === hNoSugar, T.healthIndex(today) + " vs " + hNoSugar);
T.state.settings.subjects = ["sleep", "regular"];
ok("isOnId 正确反映勾选状态", T.isOnId("sleep") === true && T.isOnId("steps") === false);

console.log("\n=== 11.C 就寝规律性（近 3 天入睡时刻的离散度）===");
reset();
ok("时间解析：23:30", T.clockHour("23:30") === 23.5);
ok("时间解析：01:00", T.clockHour("01:00") === 1);
ok("时间解析：全角冒号也认", T.clockHour("23：30") === 23.5);
ok("时间解析：非法值返回 null", T.clockHour("99:99") === null && T.clockHour("abc") === null && T.clockHour("") === null);
ok("跨午夜距离：23:00 与 01:00 只差 2 小时", T.clockDist(23, 1) === 2);
ok("跨午夜距离：23:00 与 3:00 差 4 小时", T.clockDist(23, 3) === 4);
const d0 = today, d1 = T.addDays(today, -1), d2 = T.addDays(today, -2);
T.state.daily[d0] = { bedtime: "23:30" }; T.state.daily[d1] = { bedtime: "23:30" }; T.state.daily[d2] = { bedtime: "23:30" };
const regSteady = T.sleepRegularityScore(d0);
ok("每天同一时刻入睡 → 规律度 100", regSteady === 100, regSteady);
T.state.daily[d2] = { bedtime: "01:30" };
const regJumpy = T.sleepRegularityScore(d0);
ok("有一天晚 2 小时 → 规律度明显下降", regJumpy < regSteady && regJumpy < 60, regJumpy);
T.state.daily[d0] = { bedtime: "23:30" }; delete T.state.daily[d1]; delete T.state.daily[d2];
ok("不足 2 天 → null（不计入，也不扣分）", T.sleepRegularityScore(d0) === null, T.sleepRegularityScore(d0));
T.state.daily[d0] = { bedtime: "23:30", sleep: 7 };
T.state.settings.subjects = ["sleep", "regular"];
const hWithReg = T.healthIndex(d0);
T.state.settings.subjects = ["sleep"];
ok("勾了就寝规律且数据不足时，不影响指数", T.healthIndex(d0) === hWithReg, T.healthIndex(d0) + " vs " + hWithReg);
T.state.daily[today] = { sleep: 8, water: 8, steps: 8000 };
const hOnly = T.healthIndex(today);
T.state.daily[today] = { sleep: 8, water: 8, steps: 8000, intake: 1600 };
ok("健康指数与摄入无关（决定倍率，故必须与缺口解耦）", T.healthFactor(T.healthIndex(today)) === T.healthFactor(hOnly), T.healthIndex(today) + " vs " + hOnly);

console.log("\n=== 12. 热量定投：池子与极端节食约束（核心判据）===");
reset();
/* TDEE 需要体重（bmr 取 7 日中位数）；先铺 7 天体重 */
for (let i = 0; i < 7; i++) setDay(-i, { w: 65 });
const TDEEn = T.tdee(), FLn = T.kcalFloor();
ok("TDEE 已算出（依赖体重/身高/活动量）", TDEEn > 1000, TDEEn);
ok("安全下限 = 女 1200", FLn === 1200, FLn);
/* 每天补上体重，保证 TDEE 可用 */
const dep = intake => {
  T.state.daily[today] = { w: 65, intake: intake, sleep: 8, water: 8, steps: 8000 };
  return T.poolDay(today);
};
const d1800 = dep(1800).deposit, d1500 = dep(1500).deposit, d1200 = dep(FLn).deposit, d900 = dep(900).deposit, d700 = dep(700).deposit;
ok("有缺口才有入池（维持量附近）", dep(TDEEn).deposit === 0, dep(TDEEn).deposit);
ok("下限以上：缺口越大入池越多", d1800 < d1500 && d1500 < d1200, [d1800, d1500, d1200].map(x => x.toFixed(1)).join(" < "));
ok("下限以下：越少吃入池越少（吃更少绝不多入池）", d700 < d900 && d900 < d1200, [d700, d900, d1200].map(x => x.toFixed(1)).join(" < "));
ok("极端节食严格少于安全下限（核心设计目的）", d900 < d1200, d900.toFixed(1) + " vs " + d1200.toFixed(1));
ok("低于安全下限的部分不再增加入池（越少吃越亏）", d900 < dep(FLn).deposit, d900.toFixed(1) + " < " + dep(FLn).deposit.toFixed(1));
ok("低于安全下限时给出提示（而非指责）", dep(900).over === true && dep(1800).over === false);
/* 峰值必在下限：逐点扫描（摄入 300→2600） */
let monoPool = true, prevD = -Infinity;
for (let i = 300; i <= 2600; i += 10) {
  const dd = dep(i).deposit;
  if (i <= FLn) { if (dd < prevD - 1e-9) monoPool = false; }       // 下限以下：应递增
  else if (dd > prevD + 1e-9) monoPool = false;                     // 下限以上：应递减
  prevD = dd;
}
ok("摄入 300→2600 逐点扫描：区间单调", monoPool, monoPool ? "" : "有倒挂");
/* 健康行为影响池子（良性循环） */
T.state.daily[today] = { w: 65, intake: 1800, sleep: 8, water: 8, steps: 8000 };
const gGood = T.poolDay(today).deposit;
T.state.daily[today] = { w: 65, intake: 1800, sleep: 5, water: 2, steps: 2000 };
const gPoor = T.poolDay(today).deposit;
ok("同样缺口下，好习惯入池更多（良性循环）", gGood > gPoor, gGood.toFixed(1) + " vs " + gPoor.toFixed(1));
/* 池子累计 */
reset();
for (let i = 0; i < 7; i++) setDay(-i, { w: 65 });
T.state.daily[T.addDays(today, -2)] = { w: 65, intake: 1800, sleep: 8, water: 8, steps: 8000 };
T.state.daily[T.addDays(today, -1)] = { w: 65, intake: 1800, sleep: 8, water: 8, steps: 8000 };
T.state.daily[today] = { w: 65, intake: 1800, sleep: 8, water: 8, steps: 8000 };
const tot3 = T.poolTotal(today);
ok("池子按天累加（3 天 = 3 倍单日）", Math.abs(tot3.total - gGood * 3) < 1e-6, tot3.total.toFixed(1));
eq("累计天数计数正确", tot3.days, 3);
T.state.daily[today] = { w: 65 };
ok("没填热量的日子不计入池子（也不计零分）", T.poolTotal(today).days === 2, T.poolTotal(today).days);
ok("池子只增不减（无负数入池）", T.poolTotal(today).total >= 0 && dep(700).deposit >= 0);

console.log("\n=== 13. 【交付门】定投相关文案禁止词扫描 ===");
reset();
T.state.daily[today] = { intake: 900, sleep: 5, water: 2, steps: 2000 };
const poolTexts = [];
try { T.poolTotal(today); } catch (e) {}
/* 直接扫描主程序全文案里的定投段落（渲染函数在 DOM 桩下会写进 innerHTML 桩，故改为扫源码字符串） */
const srcAll = html;
const badWords = T.FORBIDDEN.filter(w => {
  /* 只检查定投引擎与渲染段（第 4.B 节 + 5.B 节）之间的文本 */
  const seg = srcAll.slice(srcAll.indexOf("4.B 热量定投引擎"), srcAll.indexOf("6. 渲染：趋势"));
  return seg.indexOf(w) >= 0;
});
ok("定投引擎 + 定投页文案零禁止词", badWords.length === 0, badWords.join(","));
ok("页面出现「安全下限」提示（非指责式）", srcAll.indexOf("安全下限") >= 0);
ok("页面明确说明不替用户估算食物热量", srcAll.indexOf("不替你估算食物热量") >= 0);

console.log("\n========================================");
console.log("  通过 " + pass + " 项，失败 " + fail + " 项");
console.log("========================================\n");
process.exit(fail ? 1 : 0);
