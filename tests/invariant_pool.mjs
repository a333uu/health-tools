import fs from "node:fs"; import vm from "node:vm";
const html = fs.readFileSync("减重助手.html","utf8");
const js = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)[1];
function makeEl(){const el={textContent:"",innerHTML:"",value:"",style:{},files:null,_attrs:{},_cls:new Set(),addEventListener(){},removeEventListener(){},appendChild(){},removeChild(){},setAttribute(k,v){el._attrs[k]=String(v)},getAttribute(k){return k in el._attrs?el._attrs[k]:null},querySelector(){return null},querySelectorAll(){return[]},closest(){return null},focus(){},click(){},classList:{add(){},remove(){},toggle(){},contains(){return false}}};return el;}
const store=new Map();
const ctx={console:{log(){},warn(){},error(){}},setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},document:{querySelector:()=>makeEl(),querySelectorAll:()=>[],addEventListener(){},createElement:()=>makeEl(),body:{appendChild(){},removeChild(){}},hidden:false},window:{addEventListener(){},scrollTo(){}},Blob:class{},URL:{createObjectURL:()=>"",revokeObjectURL(){}},FileReader:class{},Date,Math,JSON,String,Number,Object,Array,RegExp,Error,isNaN,parseFloat,parseInt};
ctx.globalThis=ctx;ctx.self=ctx;
vm.createContext(ctx);
vm.runInContext(js + ";globalThis.__T={get state(){return state},set state(v){state=v},tdee,kcalFloor,poolDay,healthIndex,addDays,todayStr};", ctx);
const T=ctx.__T;
T.state.profile=Object.assign(T.state.profile,{sex:"f",birthYear:new Date().getFullYear()-30,height:165,activity:1.375});
const t=T.todayStr();
T.state.daily={}; for(let i=0;i<7;i++) T.state.daily[T.addDays(t,-i)]={w:65};
const FL=T.kcalFloor(), TD=T.tdee();
const beh={w:65,sleep:8,water:8,steps:8000,protein:true};
let pass=0,fail=0; const ok=(n,c,x)=>{c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n+"  → "+x))};
const dep=i=>{T.state.daily[t]=Object.assign({intake:i},beh); return T.poolDay(t).deposit;};
console.log("  [档案] TDEE="+TD.toFixed(0)+" 安全下限="+FL);
T.state.daily[t]=Object.assign({intake:1500},beh); const hA=T.healthIndex(t);
T.state.daily[t]=Object.assign({intake:900},beh);  const hB=T.healthIndex(t);
ok("健康指数与摄入无关（900 与 1500 同日指数相同）", hA===hB, hA+" vs "+hB);
let mono=true, prev=-Infinity, peak=0, peakV=-1;
for(let i=300;i<=2600;i+=10){ const d=dep(i); if(d>peakV){peakV=d;peak=i;}
  if(i<=FL){ if(d<prev-1e-9) mono=false; } else if(d>prev+1e-9) mono=false; prev=d; }
ok("峰值仍在下限、两侧单调（核心不变量）", mono && peak===FL, "peak="+peak+" FL="+FL);
ok("极端(900) < 安全下限(1200)", dep(900) < dep(FL), dep(900).toFixed(1)+" vs "+dep(FL).toFixed(1));
ok("极端(900) < 更深合法缺口处无（900 已在下限以下）", dep(900) < dep(1100), dep(900).toFixed(1)+" vs "+dep(1100).toFixed(1));
ok("下限以下越少吃越亏", dep(700) < dep(900) && dep(900) < dep(1100), [700,900,1100].map(x=>dep(x).toFixed(0)).join(" < "));
ok("维持量入池为 0", dep(Math.round(TD))===0, dep(Math.round(TD)));
T.state.daily[t]=Object.assign({intake:1500},beh); const gGood=T.poolDay(t).deposit;
T.state.daily[t]={w:65,intake:1500,sleep:5,water:2,steps:2000,protein:false}; const gPoor=T.poolDay(t).deposit;
ok("好习惯 > 差习惯（良性循环仍在）", gGood>gPoor, gGood.toFixed(0)+" vs "+gPoor.toFixed(0));
const r=gGood/gPoor;
ok("好/差 倍数在 1.3–3.0（不过分）", r>1.3&&r<3.0, r.toFixed(2)+"×");
console.log("\n  核心不变量：通过 "+pass+" 项，失败 "+fail+" 项");
process.exit(fail?1:0);
