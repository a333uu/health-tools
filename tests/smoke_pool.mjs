import fs from "node:fs"; import vm from "node:vm";
const html = fs.readFileSync("减重助手.html","utf8");
const js = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
const els = {};
function makeEl(id){ const el={_id:id,textContent:"",innerHTML:"",value:"",style:{},files:null,_attrs:{},_cls:new Set(),
  addEventListener(){},removeEventListener(){},appendChild(){},removeChild(){},
  setAttribute(k,v){el._attrs[k]=String(v)},getAttribute(k){return k in el._attrs?el._attrs[k]:null},
  querySelector(){return null},querySelectorAll(){return[]},closest(){return null},focus(){},click(){},
  classList:{add(n){el._cls.add(n)},remove(n){el._cls.delete(n)},toggle(n,v){v?el._cls.add(n):el._cls.delete(n)},contains(n){return el._cls.has(n)}}}; return el; }
const store=new Map();
const ctx={console:{log(){},warn(){},error(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},
 localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
 document:{querySelector:(s)=>{ if(!els[s]) els[s]=makeEl(s); return els[s]; },querySelectorAll:()=>[],addEventListener(){},createElement:()=>makeEl("new"),
  body:{appendChild(){},removeChild(){}},hidden:false},
 window:{addEventListener(){},scrollTo(){}},Blob:class{},URL:{createObjectURL:()=>"",revokeObjectURL(){}},FileReader:class{},
 Date,Math,JSON,String,Number,Object,Array,RegExp,Error,isNaN,parseFloat,parseInt};
ctx.globalThis=ctx;ctx.self=ctx;
vm.createContext(ctx);
vm.runInContext(js + ";globalThis.__T={get state(){return state},set state(v){state=v},renderToday,renderPool,renderMe,renderAll,switchTab,addDays,todayStr,tdee,kcalFloor,enabledSubjectIds,SUBJECTS};", ctx);
const T=ctx.__T;
T.state.profile=Object.assign(T.state.profile,{sex:"f",birthYear:new Date().getFullYear()-30,height:165,activity:1.375,startWeight:70,targetWeight:60});
const t=T.todayStr();
T.state.daily={};
for(let i=0;i<7;i++) T.state.daily[T.addDays(t,-i)]={w:65};
T.state.daily[t]={w:65,intake:1500,sleep:7.5,water:7,steps:7000,protein:true};
let pass=0,fail=0;
const ok=(n,c,x)=>{ if(c){pass++;console.log("  PASS  "+n)} else {fail++;console.log("  FAIL  "+n+(x!==undefined?"  → "+x:""))} };
try { T.renderToday(); } catch(e){ console.log("renderToday 抛错:",e.message); }
const todayHtml = els["#view-today"].innerHTML;
ok("renderToday 渲染出内容", todayHtml.length > 500, todayHtml.length);
ok("今日页含热量输入框", todayHtml.indexOf('data-field="intake"') >= 0);
ok("今日页含定投卡（填了热量后出现）", todayHtml.indexOf("今天的热量定投") >= 0);
ok("今日页显示入池与累计", todayHtml.indexOf("今日入池") >= 0 && todayHtml.indexOf("定投池累计") >= 0);
try { T.renderPool(); } catch(e){ console.log("renderPool 抛错:",e.message); }
const poolHtml = els["#view-pool"].innerHTML;
ok("renderPool 渲染出内容", poolHtml.length > 500, poolHtml.length);
ok("定投页含主指标（池子总额）", poolHtml.indexOf("热量定投池") >= 0);
ok("定投页含今日明细（TDEE/摄入/缺口/计入）", poolHtml.indexOf("今日消耗（TDEE）") >= 0 && poolHtml.indexOf("计入池子的缺口") >= 0);
ok("定投页含健康指数分解", poolHtml.indexOf("健康指数怎么来的") >= 0 && poolHtml.indexOf("记录完整度") >= 0);
ok("定投页含两周柱状", poolHtml.indexOf("最近两周的入池") >= 0);
ok("定投页含规则说明", poolHtml.indexOf("定投是怎么算的") >= 0);
ok("定投页无 undefined/NaN", poolHtml.indexOf("undefined") < 0 && poolHtml.indexOf("NaN") < 0);
/* 极端节食路径 */
T.state.daily[t]={w:65,intake:900,sleep:5,water:2,steps:2000};
T.renderToday(); T.renderPool();
const t2 = els["#view-today"].innerHTML, p2 = els["#view-pool"].innerHTML;
ok("极端节食：今日页给出安全下限提示", t2.indexOf("低于安全下限") >= 0);
ok("极端节食：定投页给出安全下限提示", p2.indexOf("低于安全下限") >= 0);
ok("极端节食：提示里含就医/咨询引导", p2.indexOf("医生") >= 0 || p2.indexOf("营养师") >= 0);
ok("极端节食：渲染无 undefined/NaN", p2.indexOf("undefined") < 0 && p2.indexOf("NaN") < 0);
/* 空数据路径 */
T.state.daily={};
T.renderToday(); T.renderPool();
ok("空数据：定投页给出引导而非崩溃", els["#view-pool"].innerHTML.indexOf("定投就开始了") >= 0);
ok("空数据：今日页正常", els["#view-today"].innerHTML.length > 300);
/* ---- 我的页：健康科目勾选区 ---- */
try { T.renderMe(); } catch(e){ console.log("renderMe 抛错:",e.message); }
const meHtml = els["#view-me"].innerHTML;
ok("renderMe 渲染出内容", meHtml.length > 500, meHtml.length);
ok("我的页含「健康科目」区", meHtml.indexOf("健康科目") >= 0);
ok("10 个科目全部出现在勾选区", ["睡眠时长","饮水","步数","蛋白质","就寝规律","每天称重","液体热量","蔬菜纤维","饮酒","放松活动"].every(x => meHtml.indexOf(x) >= 0));
ok("勾选按钮带 data-act=subject", meHtml.indexOf('data-act="subject"') >= 0);
ok("明确写出「未勾选不参与、也不扣分」", meHtml.indexOf("不参与健康指数，也不扣分") >= 0);
ok("我的页无 undefined/NaN", meHtml.indexOf("undefined") < 0 && meHtml.indexOf("NaN") < 0);
/* ---- 今日页：科目条件显示 ---- */
T.state.settings.subjects = ["sleep"];
T.renderToday();
const tOnlySleep = els["#view-today"].innerHTML;
ok("只勾睡眠时：今日页只显示睡眠输入", tOnlySleep.indexOf('data-field="sleep"') >= 0 && tOnlySleep.indexOf('data-field="steps"') < 0 && tOnlySleep.indexOf('data-field="water"') < 0);
ok("只勾睡眠时：热量输入仍在（定投入口）", tOnlySleep.indexOf('data-field="intake"') >= 0);
T.state.settings.subjects = ["sleep","water","steps","protein","regular","weigh"];
T.renderToday();
const tAll = els["#view-today"].innerHTML;
ok("默认 6 科时：6 个科目输入都在（蛋白质/饮水是按钮，用 data-act 判）", ['data-field="sleep"','data-field="steps"','data-act="water"','data-field="protein"','data-field="bedtime"','data-field="w"'].every(x => tAll.indexOf(x) >= 0));
T.state.settings.subjects = ["sleep","water","steps","protein","regular","weigh","liquid","veg","alcohol","unwind"];
T.renderToday();
const tTen = els["#view-today"].innerHTML;
ok("10 科全勾时：6 个输入 + 5 个二选一按钮都在",
   ['data-field="sleep"','data-field="steps"','data-act="water"','data-field="bedtime"','data-field="w"','data-field="intake"',
    'data-field="protein"','data-field="liquid"','data-field="veg"','data-field="alcohol"','data-field="unwind"'].every(x => tTen.indexOf(x) >= 0));
ok("新增二选一科目有各自的选项文案", ["没喝","喝了","吃够","没够","做了","没做"].every(x => tTen.indexOf(x) >= 0));
T.state.settings.subjects = [];
T.renderToday();
ok("一个都不勾时：给出「去勾选」出口", els["#view-today"].innerHTML.indexOf('data-act="gome"') >= 0);
/* ---- 【回归】手机布局：文本框型字段必须与 number 型同样受宽度约束 ---- */
const cssHtml = fs.readFileSync("减重助手.html", "utf8");
ok("CSS 给 text 输入也设了宽度（修「昨晚几点睡」竖排 bug）",
   /\.logrow input\[type=number\][^{]*input\[type=text\][^{]*\{[^}]*width:/.test(cssHtml));
ok("窄屏媒体查询也同时覆盖 number 与 text",
   /max-width:360px\)\{[\s\S]*?input\[type=number\][\s\S]*?input\[type=text\]/.test(cssHtml));
ok("标签文字禁止竖排换行（nowrap + 省略号）",
   /\.logrow \.lb \.t\{[^}]*white-space:nowrap/.test(cssHtml));
console.log("\n  渲染冒烟：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail?1:0);
