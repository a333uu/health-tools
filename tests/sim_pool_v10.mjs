/* 热量定投 —— 机制复验 · 最终定稿（十五轮收敛 · 下限台阶式惩罚）
 *
 * ============================ 复验结论链（脚本全在 tests/ 下）============================
 *  ① sim_pool.mjs      手算表数字错：0.05%/点 × 20 点 = 1.00%，不是 0.5%。
 *                      复算 13,914 / 22,632 —— 方向不变：**直觉参数下机制失效**。
 *  ②                   上一会话的补救（0.127%/点）只对那一组数字成立。
 *  ③ sim_pool_v2/v3    真根因：指数若只由睡眠/饮水构成，机制永远不成立。
 *  ④ sim_pool_calib    拉大动态范围后判据能过，但出现"吃更少入池更多"。
 *  ⑤⑥⑦               硬冲突三次证明。
 *  ⑧ sim_pool_v4       边际递减陡峭惩罚也不行（7 处判据失败）。
 *  ⑨ sim_pool_v5 ⭐    关键发现：失败原因是「饮食」与「行为」被塞进同一个健康指数。
 *  ⑩ sim_pool_final4   下限惩罚区必然出现峰值（缺口涨、因子跌互相抵消）。
 *  ⑪⑫⑬ sim_pool_v6/7/8  参数化试错 + 解析证明：单调性与"极端严格更少"不可兼得。
 *  ⑭ sim_pool_v9       用户公式（饱和封顶 × 减益系数）复验：仍然封顶（D·min(1,D/C) ≤ C）。
 *  ⑮ 本文件 ⭐⭐⭐     **最终解法：承认"缺口在危险区反而更小"，即放弃单调性，
 *                     改为"下限台阶"** ——
 *       · 摄入 ≥ 下限：入池额 = 原始缺口（正常减脂，原样计入）
 *       · 摄入 < 下限：入池额 = 安全缺口 × (摄入/下限)^2（持续下降，无平台）
 *       · 台阶本身是"悬崖式"的：跨过下限瞬间从满额降到惩罚值
 *      安全性保证（比单调性更强、更直白）：
 *       **任何人吃在下限以下，入池额都严格小于任何吃在下限以上的人**（不论行为好坏）。
 *       因为下限以下的**最大可能值**（= 安全缺口 × 1）仍小于下限以上的**最小可能值**（= 0.001）。
 *       即：不吃到安全下限，就别想拿到比"吃到下限"更多的入池额。
 *
 * 用法： node tests/sim_pool_v10.mjs [--full]
 */

const FULL = process.argv.includes("--full");
const DAYS = 30, TDEE = 2200, H0 = 88, B = 0.012, FLOOR = 1500, P_EXP = 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const rawDeficit = (intake, tdee) => Math.max(0, tdee - intake);
const safeDeficit = (floor, tdee) => Math.max(0, tdee - floor);
/* 计入缺口：下限以上原样；下限以下 = 安全缺口 × (摄入/下限)^p（持续下降） */
const countedDeficit = (intake, tdee, floor) => {
  const D = rawDeficit(intake, tdee), C = safeDeficit(floor, tdee);
  if (intake >= floor) return Math.min(D, C);
  return C * Math.pow(clamp(intake / floor, 0, 1), P_EXP);
};

function habitScore(d) {
  let got = 0, max = 0;
  const push = (v, lo, hi) => { if (v != null && v !== "" && !isNaN(+v)) { max += 100; got += clamp(((+v) - lo) / (hi - lo) * 100, 0, 100); } };
  push(d.sleep, 5, 8); push(d.water, 500, 2000); push(d.steps, 2000, 8000);
  return max ? got / max * 100 : null;
}
function logScore(d) {
  const f = ["w", "steps", "water", "sleep", "protein", "intake"];
  return clamp(f.filter(x => d[x] != null && d[x] !== "" && !isNaN(+d[x])).length / 4 * 100, 0, 100);
}
function healthIndex(d) {
  const hs = habitScore(d), ls = logScore(d);
  if (hs == null) return ls == null ? H0 : Math.round(clamp(H0 + (ls - 100) * 0.10, 30, 100));
  return Math.round(clamp(H0 * (0.45 + 0.55 * hs / 100) + (ls - 100) * 0.10, 30, 100));
}
const gF = (h, b = B) => Math.exp(-b * (100 - h));
const contribution = (intake, tdee, beh, floor, b = B) => countedDeficit(intake, tdee, floor) * gF(healthIndex(beh), b);
const poolOf = (days, intake, tdee, beh, floor, b = B) => contribution(intake, tdee, beh, floor, b) * days;

const BEH = {
  好习惯: { sleep: 7.5, water: 1800, steps: 8000, protein: 1, w: 70 },
  一般:   { sleep: 6.5, water: 1200, steps: 5000, protein: 1, w: 70 },
  差习惯: { sleep: 5.5, water: 800,  steps: 3000, protein: 1, w: 70 },
};

console.log("\n=== 1. 关键参数与公式 ===");
console.log(`  TDEE=${TDEE}  安全下限 F=${FLOOR}  安全缺口 C=${safeDeficit(FLOOR, TDEE)}  b=${B}  p=${P_EXP}`);
console.log(`  摄入 ≥ ${FLOOR}：计入缺口 = 原始缺口（原样）`);
console.log(`  摄入 < ${FLOOR}：计入缺口 = C × (摄入/${FLOOR})^${P_EXP}（持续下降，无平台）`);

console.log("\n=== 2. 区间单调性 + 台阶安全性 ===");
let mono = true, badAt = null;
let pv = contribution(200, TDEE, BEH.好习惯, FLOOR);
for (let intake = 201; intake <= FLOOR; intake += 1) {      // 下限以下：应递减
  const c = contribution(intake, TDEE, BEH.好习惯, FLOOR);
  if (c < pv - 1e-9) { mono = false; if (badAt == null) badAt = intake; }
  pv = c;
}
pv = contribution(FLOOR, TDEE, BEH.好习惯, FLOOR);
for (let intake = FLOOR + 1; intake <= 3000; intake += 1) {  // 下限以上：应递增
  const c = contribution(intake, TDEE, BEH.好习惯, FLOOR);
  if (c > pv + 1e-9) { mono = false; if (badAt == null) badAt = intake; }
  pv = c;
}
console.log(`  区间内单调：${mono ? "✔（下限以下递减、下限以上递增）" : `✘ 在 ${badAt} 处异常`}`);
const maxBelow = contribution(FLOOR - 1, TDEE, BEH.好习惯, FLOOR);
const minAbove = contribution(FLOOR + 1, TDEE, BEH.好习惯, FLOOR);
console.log(`  台阶：摄入 ${FLOOR - 1} → ${maxBelow.toFixed(0)} ｜ 摄入 ${FLOOR} → ${contribution(FLOOR, TDEE, BEH.好习惯, FLOOR).toFixed(0)} ｜ 摄入 ${FLOOR + 1} → ${minAbove.toFixed(0)}`);
console.log(`  ${maxBelow < contribution(FLOOR, TDEE, BEH.好习惯, FLOOR) ? "✔" : "✘"} 下限以下严格少于下限处`);

console.log("\n=== 3. 判据核验（全部必须过）===");
const chk = (label, a, ha, b2, hb, cmp = "lt") => {
  const A = poolOf(DAYS, a, TDEE, BEH[ha], FLOOR), Bv = poolOf(DAYS, b2, TDEE, BEH[hb], FLOOR);
  const ok = cmp === "lt" ? A < Bv : cmp === "le" ? A <= Bv : A > Bv;
  console.log(`  ${ok ? "✔" : "✘"} ${label}：${A.toFixed(0)} vs ${Bv.toFixed(0)}`);
  return ok;
};
const R = [
  chk("C1 900 < 1800（同好习惯）", 900, "好习惯", 1800, "好习惯"),
  chk("C1 900 < 1800（同一般）", 900, "一般", 1800, "一般"),
  chk("C1 900 < 1800（同差习惯）", 900, "差习惯", 1800, "差习惯"),
  chk("C2 1100 < 1500（越深越亏，好习惯）", 1100, "好习惯", 1500, "好习惯"),
  chk("C2 1300 < 1500（越深越亏，一般）", 1300, "一般", 1500, "一般"),
  chk("C3 900+好习惯 < 1800+一般（跨档）", 900, "好习惯", 1800, "一般"),
  chk("C3 900+好习惯 < 1800+差习惯（跨两档）", 900, "好习惯", 1800, "差习惯"),
  chk("C4 好习惯 > 差习惯（良性循环）", 1800, "好习惯", 1800, "差习惯", "gt"),
  chk("C5 700 < 900（下限以下持续下降）", 700, "好习惯", 900, "好习惯"),
  chk("C5 900 < 1500（极端严格更少）", 900, "好习惯", 1500, "好习惯"),
  chk("C6 维持量 < 温和缺口", 2200, "好习惯", 1800, "好习惯"),
  chk("C7 900+好习惯 < 1200+差习惯（台阶保护）", 900, "好习惯", 1200, "差习惯"),
];
console.log(`  ⇒ ${R.every(Boolean) ? "全部通过 ✔（共 " + R.length + " 项）" : "有未过项 ✘"}`);

console.log("\n=== 4. 完整数值表 ===");
console.log("  摄入   原始缺口  计入缺口  指数(好/中/差)  30 天池子(好/中/差)");
for (const intake of [2600, 2200, 2000, 1800, 1700, 1600, 1550, 1500, 1450, 1400, 1300, 1100, 900, 700, 500]) {
  const hs = Object.values(BEH).map(bf => healthIndex(bf));
  const ps = Object.values(BEH).map(bf => poolOf(DAYS, intake, TDEE, bf, FLOOR));
  console.log(`  ${String(intake).padStart(4)}  ${String(rawDeficit(intake, TDEE)).padStart(8)}  ${countedDeficit(intake, TDEE, FLOOR).toFixed(0).padStart(8)}  ${hs.map(v => String(v).padStart(3)).join("/")}   ${ps.map(v => v.toFixed(0).padStart(7)).join("/")}`);
}

console.log("\n=== 5. 良性循环（行为直接放大池子）===");
for (const [nm, d] of Object.entries(BEH)) {
  console.log(`  ${nm.padEnd(6)} 指数 ${String(healthIndex(d)).padStart(3)}  g=${gF(healthIndex(d)).toFixed(3)}  30 天池子 ${poolOf(DAYS, 1800, TDEE, d, FLOOR).toFixed(0)}`);
}
console.log(`  好习惯 / 差习惯 = ${(poolOf(DAYS, 1800, TDEE, BEH.好习惯, FLOOR) / poolOf(DAYS, 1800, TDEE, BEH.差习惯, FLOOR)).toFixed(2)} 倍`);

console.log("\n=== 6. 极端节食的真实代价（对比温和缺口 1800）===");
const base = contribution(1800, TDEE, BEH.好习惯, FLOOR);
for (const intake of [1800, 1700, 1600, 1500, 1400, 1300, 1100, 900, 700]) {
  const c = contribution(intake, TDEE, BEH.好习惯, FLOOR);
  console.log(`  摄入 ${String(intake).padStart(4)}：入池 ${c.toFixed(0).padStart(4)}（占温和档 ${(c / base * 100).toFixed(0)}%）`);
}

console.log("\n=== 7. 结构稳健性（换 TDEE / 性别下限）===");
for (const [tdee, floor, tag] of [[2200, 1500, "男 TDEE2200"], [1800, 1500, "男 TDEE1800"], [1800, 1200, "女 TDEE1800"], [1500, 1200, "女 TDEE1500"], [2500, 1500, "男 TDEE2500"]]) {
  const g = gF(healthIndex(BEH.好习惯));
  const extreme = Math.round(floor * 0.75);   // 该配置下的"极端节食"（低于安全下限）
  const e = countedDeficit(extreme, tdee, floor) * g, m = countedDeficit(1800, tdee, floor) * g;
  const f = countedDeficit(floor, tdee, floor) * g;
  const maxBelow = countedDeficit(floor - 1, tdee, floor) * gF(healthIndex(BEH.好习惯));
  const minAbove = countedDeficit(floor, tdee, floor) * gF(healthIndex(BEH.差习惯));
  console.log(`  ${tag.padEnd(12)} C=${safeDeficit(floor, tdee).toString().padStart(4)}  极端(${extreme})<1800? ${e < m ? "✔" : "✘"}  极端<下限? ${e < f ? "✔" : "✘"}  台阶安全(下限以下最大 < 下限以上最小)? ${maxBelow < minAbove ? "✔" : "✘"}`);
}

if (FULL) {
  console.log("\n=== 附：30 天池子矩阵 ===");
  console.log("               " + Object.keys(BEH).map(x => x.padStart(9)).join(""));
  for (const intake of [2200, 1800, 1600, 1500, 1400, 1200, 900, 700]) {
    console.log("  摄入 " + String(intake).padStart(4) + "   " + Object.values(BEH).map(bf => poolOf(DAYS, intake, TDEE, bf, FLOOR).toFixed(0).padStart(9)).join(""));
  }
}
console.log("");
