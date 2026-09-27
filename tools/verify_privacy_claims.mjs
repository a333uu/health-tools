/* verify_privacy_claims.mjs —— 把 README 里的隐私主张变成可执行的门
 *
 * 针对的错误类：「文档里承诺隐私、代码里偷偷联网」——承诺与代码脱节，
 * 而且脱节时没人会发现（没有机械检查）。
 *
 * 用法：node tools/verify_privacy_claims.mjs
 * 退出码：0 = 全部主张成立；1 = 有主张被代码推翻
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

const apps = ["减重助手.html", "服药提醒.html"];

/* 每个主张 = { 名字, 检查函数(源码) -> 命中的证据数组, 期望命中数 } */
const claims = [
  {
    name: "零网络调用",
    why: "不应有任何出网 API",
    find: s => [
      "fetch(", "XMLHttpRequest", "WebSocket", "EventSource",
      "sendBeacon", "import(", "require(", "navigator.connection"
    ].filter(p => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g").test(s))
  },
  {
    name: "零外部资源",
    why: "不应引用任何 http(s) 资源或外部脚本/样式",
    find: s => {
      const hits = [];
      if (/<script[^>]*\ssrc=/i.test(s)) hits.push("<script src>");
      if (/<link[^>]*rel=["']?stylesheet/i.test(s)) hits.push("<link stylesheet>");
      if (/<img[^>]*\ssrc=["']https?:/i.test(s)) hits.push("<img src=http>");
      const urls = s.match(/https?:\/\/[^\s"'<>)]+/g) || [];
      const nonDoc = urls.filter(u => !/^https?:\/\/(www\.)?(w3\.org|schema\.org)/.test(u));
      if (nonDoc.length) hits.push("URL: " + nonDoc.slice(0, 3).join(", "));
      return hits;
    }
  },
  {
    name: "零追踪",
    why: "不应有任何分析/遥测 SDK 或上报路径",
    find: s => [
      "analytics", "gtag", "googletagmanager", "mixpanel",
      "sentry", "telemetry", "amplitude", "/collect", "beacon."
    ].filter(p => s.toLowerCase().includes(p.toLowerCase()))
  }
];

let failed = 0;
let checked = 0;

console.log("=== 隐私主张机械校验 ===");
console.log("（这些主张写在 README 里，本脚本保证代码不推翻它们）\n");

for (const rel of apps) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.log(`  [跳过] ${rel} 不存在`);
    continue;
  }
  const src = fs.readFileSync(p, "utf8");
  console.log(`${rel}（${src.length} 字符）`);
  for (const c of claims) {
    checked++;
    const hits = c.find(src);
    if (hits.length === 0) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.name} —— 命中：${hits.join(" / ")}`);
      console.log(`        期望：${c.why}`);
    }
  }
  console.log("");
}

/* 单文件自足性：不依赖同目录其它文件 */
console.log("单文件自足性");
for (const rel of apps) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) continue;
  checked++;
  const src = fs.readFileSync(p, "utf8");
  /* 抓本地相对引用的 src/href（非 http、非 data:、非 #） */
  const localRefs = [...src.matchAll(/(?:src|href)=["'](?!https?:|data:|#|mailto:)([^"']+)["']/gi)]
    .map(m => m[1]);
  if (localRefs.length === 0) {
    console.log(`  PASS  ${rel} 不引用任何本地外部文件`);
  } else {
    failed++;
    console.log(`  FAIL  ${rel} 引用了本地文件：${localRefs.join(", ")}`);
  }
}

console.log("\n" + "=".repeat(40));
console.log(failed === 0
  ? `全部通过：${checked} 项主张，0 项被代码推翻`
  : `有 ${failed} 项主张被代码推翻（共校验 ${checked} 项）`);
process.exit(failed === 0 ? 0 : 1);
