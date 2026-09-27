/* make_demo.mjs —— 生成一份【假数据】演示版 HTML，用于截图
 *
 * 为什么需要它：真实使用中的截图会泄露作者的个人健康数据
 * （体重、腰围、服药记录等）。本脚本用编造的演示数据渲染出一张
 * 任何人都能看的示例图，与作者真实数据零关联。
 *
 * 用法：node tools/make_demo.mjs <输出路径>
 * 产出：<输出路径>（自包含 HTML，打开即见演示数据，可用于截图）
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const src = path.join(root, "减重助手.html");
const out = process.argv[2] || path.join(root, "docs", "_demo.html");

const html = fs.readFileSync(src, "utf8");
const m = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
if (!m) { console.error("找不到 <script> 段"); process.exit(1); }
const js = m[1];

/* ---- 用最小 DOM 桩跑一遍真程序，拿到它自己的 localStorage 格式 ---- */
function makeEl() {
  const el = { textContent: "", innerHTML: "", value: "", style: {}, files: null,
    _attrs: {}, addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return k in el._attrs ? el._attrs[k] : null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, click() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
  return el;
}
const store = new Map();
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  document: { querySelector: () => makeEl(), querySelectorAll: () => [], addEventListener() {},
    createElement: () => makeEl(), body: { appendChild() {}, removeChild() {} }, hidden: false },
  window: { addEventListener() {}, scrollTo() {} },
  Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL() {} }, FileReader: class {},
  Date, Math, JSON, String, Number, Object, Array, RegExp, Error, isNaN, parseFloat, parseInt
};
ctx.globalThis = ctx; ctx.self = ctx;
vm.createContext(ctx);
vm.runInContext(js + ";globalThis.__T={get state(){return state},set state(v){state=v},tdee,kcalFloor,addDays,todayStr,STORE_KEY};", ctx);
const T = ctx.__T;

/* ---- 编造的演示数据：一个虚构的人，减重 6 周 ---- */
T.state.profile = {
  sex: "f",
  birthYear: new Date().getFullYear() - 32,
  height: 165,
  startWeight: 68.0,
  targetWeight: 60.0,
  activity: 1.375,
  waistPos: "肚脐上方 1 cm",
  waistLocked: true
};
T.state.settings = {
  firstRun: false,
  lastFeedback: "",
  subjects: ["sleep", "water", "steps", "protein", "regular", "weigh", "liquid", "veg"]
};
T.state.daily = {};
T.state.waist = {};
T.state.nsv = [
  { d: T.addDays(T.todayStr(), -30), t: "走楼梯不喘了" },
  { d: T.addDays(T.todayStr(), -12), t: "去年的裤子能穿上了" }
];
T.state.uiDate = T.todayStr();

/* 6 周体重：68.0 → 64.6，带每天的小波动（模拟真实噪声） */
const wobble = [0, .3, -.2, .1, -.3, .2, -.1, .4, -.2, 0, .1, -.4, .2, -.1];
for (let i = 41; i >= 0; i--) {
  const d = T.addDays(T.todayStr(), -i);
  const trend = 68.0 - (41 - i) * 0.083;
  const e = {
    w: Math.round((trend + wobble[i % wobble.length]) * 10) / 10,
    steps: [5200, 6800, 7300, 8100, 6400, 9200, 5800][i % 7],
    water: [5, 6, 7, 8, 6, 7, 5][i % 7],
    sleep: [6.5, 7, 7.5, 8, 6, 7.5, 7][i % 7],
    protein: (i % 3) !== 0,
    liquid: (i % 4) !== 0,
    veg: (i % 2) === 0,
    alcohol: false,
    unwind: (i % 5) !== 0,
    intake: [1600, 1750, 1500, 1680, 1820, 1550, 1700][i % 7]
  };
  /* 就寝时刻：大体规律，偶尔晚睡 */
  const bh = (i % 9 === 0) ? "01:10" : "23:%02d".replace("%02d", String(20 + (i % 20)).padStart(2, "0"));
  e.bedtime = bh;
  T.state.daily[d] = e;
}
/* 腰围：四周各一次 */
for (const i of [41, 34, 27, 20, 13, 6]) {
  T.state.waist[T.addDays(T.todayStr(), -i)] = Math.round((82.5 - (41 - i) * 0.12) * 10) / 10;
}

const stateJson = JSON.stringify(T.state);
console.error("演示数据已生成：42 天记录 / 当前体重 " + T.state.daily[T.todayStr()].w + " kg");

/* ---- 把演示数据注入 HTML，产出可直接截图的自包含文件 ---- */
const seed = `<script>
/* 演示数据（编造，非真实使用记录）——用于生成示例截图 */
try { localStorage.setItem(${JSON.stringify(T.__proto__ ? "weight_coach_v1" : "weight_coach_v1")}, ${JSON.stringify(stateJson)}); } catch (e) {}
<\/script>`;

const demo = html.replace(/<script>/, seed + "\n<script>");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, demo, "utf8");
console.error("已写出：" + out + "（" + demo.length + " 字节）");
